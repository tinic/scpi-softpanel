#!/usr/bin/env python3
"""
SCPI bridge: a thin, single-session executor between the Node/TS broker and the
instrument, spoken as newline-delimited JSON-RPC over stdio.

Design intent: this process holds the ONE control connection the SDM3045X allows
(pyvisa / pyvisa-py backend) and does nothing clever. All scheduling, state, and
policy live in the TypeScript server. Here we only: connect, query, write, close.

Protocol (one JSON object per line):
  stdin  request : {"id": <int>, "method": <str>, "params": {...}}
  stdout reply   : {"id": <int>, "ok": true,  "result": <any>}
                 | {"id": <int>, "ok": false, "error": <str>, "code": <str?>}
  stdout event   : {"event": <str>, ...}        (unsolicited, no id)
  stderr         : human-readable logs

Methods: connect, disconnect, query, write, status, ping
"""

import json
import sys
import os
import signal
import traceback

import pyvisa
from pyvisa.errors import VisaIOError


def emit(obj: dict) -> None:
    """Write one JSON line to stdout and flush (the broker reads line-by-line)."""
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def log(*args) -> None:
    print("[bridge]", *args, file=sys.stderr, flush=True)


class Bridge:
    def __init__(self) -> None:
        # pyvisa-py pure-python backend: no NI-VISA needed, container-friendly.
        self.rm = pyvisa.ResourceManager("@py")
        self.inst = None
        self.resource: str | None = None

    # -- connection lifecycle ------------------------------------------------

    def connect(self, params: dict):
        resource = params["resource"]
        timeout_ms = int(params.get("timeout_ms", 5000))
        read_term = params.get("read_termination", "\n")
        write_term = params.get("write_termination", "\n")

        self._close_quietly()
        inst = self.rm.open_resource(resource)
        inst.timeout = timeout_ms
        # Harmless for VXI-11 INSTR; required for raw ::SOCKET.
        try:
            inst.read_termination = read_term
            inst.write_termination = write_term
        except Exception:  # pragma: no cover - some sessions ignore these
            pass

        idn = inst.query("*IDN?").strip()
        self.inst = inst
        self.resource = resource
        log(f"connected {resource} -> {idn}")
        emit({"event": "connected", "resource": resource, "idn": idn})
        return {"resource": resource, "idn": idn}

    def disconnect(self, _params: dict):
        self._close_quietly()
        emit({"event": "disconnected"})
        return {"closed": True}

    def _close_quietly(self) -> None:
        if self.inst is not None:
            try:
                self.inst.close()
            except Exception:
                pass
        self.inst = None
        self.resource = None

    # -- I/O ----------------------------------------------------------------

    def _require(self):
        if self.inst is None:
            raise RuntimeError("not connected")
        return self.inst

    def query(self, params: dict):
        inst = self._require()
        cmd = params["cmd"]
        return inst.query(cmd).strip()

    def write(self, params: dict):
        inst = self._require()
        cmd = params["cmd"]
        inst.write(cmd)
        return {"written": cmd}

    def status(self, _params: dict):
        return {"connected": self.inst is not None, "resource": self.resource}

    def ping(self, _params: dict):
        return {"pong": True}

    # -- dispatch -----------------------------------------------------------

    def handle(self, req: dict) -> None:
        rid = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        fn = getattr(self, method, None) if method in {
            "connect", "disconnect", "query", "write", "status", "ping",
        } else None

        if fn is None:
            emit({"id": rid, "ok": False, "error": f"unknown method: {method}", "code": "ENOMETHOD"})
            return

        try:
            result = fn(params)
            emit({"id": rid, "ok": True, "result": result})
        except VisaIOError as e:
            code = getattr(e, "abbreviation", "VISA_ERROR")
            log(f"VISA error on {method}: {e}")
            emit({"id": rid, "ok": False, "error": str(e), "code": code})
            # A lost/closed link should not leave us pretending we're connected,
            # or the broker spams failing commands forever instead of reconnecting.
            # VI_ERROR_TMO is deliberately NOT here: a slow command isn't a dead
            # session. VI_ERROR_IO is: seen when the meter's TCP side dies under us.
            if code in {"VI_ERROR_CONN_LOST", "VI_ERROR_RSRC_NFOUND", "VI_ERROR_IO"}:
                self._close_quietly()
                emit({"event": "disconnected", "reason": code})
        except Exception as e:  # noqa: BLE001 - report everything to the broker
            log(f"error on {method}: {e}\n{traceback.format_exc()}")
            emit({"id": rid, "ok": False, "error": str(e), "code": "EERROR"})


def main() -> None:
    bridge = Bridge()

    def _shutdown(*_):
        bridge._close_quietly()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    emit({"event": "ready", "backend": "pyvisa-py", "pid": os.getpid()})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            emit({"event": "error", "error": f"bad json: {e}"})
            continue
        bridge.handle(req)

    bridge._close_quietly()


if __name__ == "__main__":
    main()
