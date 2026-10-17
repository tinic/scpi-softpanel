#!/usr/bin/env python3
"""Minimal SDM3045X stand-in for developing without the real meter on the LAN.

    python3 scripts/sim-meter.py [--port 5025]
    METER_HOST=127.0.0.1 cargo run -p scpi-server   # in rust/

Speaks just enough of the raw-socket SCPI dialect that scpi-core uses: *IDN?, *CLS,
FUNC?, CONF:<fn>, SENS:<fn>:{RANG,RANG:AUTO,NPLC,NULL:STAT,NULL:VAL,BAND,APER}[?],
CONT:THR:VAL[?] and READ?. Each function produces a plausible signal (slow drift +
mains ripple + noise) so the trend, histogram and statistics have something to show.
Stdlib only; one thread per client (the core only ever opens one).
"""

import argparse
import math
import random
import socketserver
import time

FUNCS = {
    # id: (nominal value, ranges, has_nplc)
    "VOLT:DC": (2.9827e-3, [0.2, 2, 20, 200, 1000], True),
    "VOLT:AC": (0.2301, [0.2, 2, 20, 200, 750], False),
    "CURR:DC": (12.47e-3, [2e-4, 2e-3, 2e-2, 0.2, 2, 10], True),
    "CURR:AC": (0.0817, [0.02, 0.2, 2, 10], False),
    "RES": (4.6982e3, [200, 2e3, 20e3, 200e3, 2e6, 10e6, 100e6], True),
    "FRES": (0.10213, [200, 2e3, 20e3, 200e3, 2e6, 10e6, 100e6], True),
    "CAP": (98.7e-9, [2e-9, 20e-9, 200e-9, 2e-6, 20e-6, 200e-6, 10e-3], False),
    "FREQ": (1000.012, None, False),
    "PER": (1 / 1000.012, None, False),
    "CONT": (float("inf"), None, False),
    "DIOD": (0.6214, None, False),
    "TEMP": (23.41, None, False),
}
# Front-panel FUNC? replies (the meter drops ":DC" for the DC functions).
FUNC_REPLY = {"VOLT:DC": "VOLT", "CURR:DC": "CURR"}
OVERLOAD = 9.9e37


class Meter:
    def __init__(self):
        self.fn = "VOLT:DC"
        self.per_fn = {
            f: {"auto": True, "range": (r or [1])[-1], "nplc": 10.0, "null": False, "nullv": 0.0}
            for f, (_, r, _) in FUNCS.items()
        }
        self.band = 20.0
        self.aper = 0.1
        self.cont_thr = 50.0
        self.t0 = time.time()

    def value(self):
        nominal, ranges, _ = FUNCS[self.fn]
        t = time.time() - self.t0
        if self.fn == "CONT":
            # Alternate open / shorted every few seconds so the tone can be tried.
            return 0.3 + random.random() * 0.2 if int(t / 4) % 2 else OVERLOAD
        drift = 0.12 * math.sin(t / 9.0) + 0.05 * math.sin(t / 2.3)
        ripple = 0.03 * math.sin(t * 2 * math.pi * 0.7)
        noise = random.gauss(0, 0.02)
        v = nominal * (1 + drift * 0.2 + ripple * 0.2 + noise * 0.05)
        st = self.per_fn[self.fn]
        if ranges and not st["auto"] and abs(v) > st["range"] * 1.2:
            return OVERLOAD
        if st["null"]:
            v -= st["nullv"]
        return v

    def handle(self, line):
        """Returns the reply string for a query, or None for a command."""
        cmd = line.strip()
        up = cmd.upper()
        if not cmd:
            return None
        if up == "*IDN?":
            return "Siglent Technologies,SDM3045X,SDM34SIM000001,1.01.01.25"
        if up == "*CLS":
            return None
        if up == "FUNC?":
            return '"%s"' % FUNC_REPLY.get(self.fn, self.fn)
        if up in ("READ?", "MEAS?"):
            return "%+.8E" % self.value()
        if up.startswith("CONF:"):
            fn = up[5:]
            if fn in FUNCS:
                self.fn = fn
                st = self.per_fn[fn]
                st["auto"], st["null"] = True, False
                self.cont_thr = 50.0
            return None
        if up.startswith("CONT:THR:VAL"):
            if up.endswith("?"):
                return "%+.8E" % self.cont_thr
            self.cont_thr = float(cmd.split()[-1])
            return None
        if up.startswith("SENS:"):
            return self.sense(up, cmd)
        return None

    def sense(self, up, cmd):
        body = up[5:]
        query = body.endswith("?")
        arg = cmd.split()[-1] if " " in cmd else None
        for fn in sorted(FUNCS, key=len, reverse=True):
            if body.startswith(fn + ":"):
                sub = body[len(fn) + 1 :].rstrip("?").split(" ")[0]
                break
        else:
            return None
        st = self.per_fn[fn]
        ranges = FUNCS[fn][1] or [1]
        if sub == "RANG:AUTO":
            if query:
                return "1" if st["auto"] else "0"
            st["auto"] = arg in ("ON", "1")
        elif sub == "RANG":
            if query:
                return "%+.8E" % st["range"]
            want = float(arg)
            st["range"] = next((r for r in ranges if r >= want), ranges[-1])
            st["auto"] = False
        elif sub == "NPLC":
            if query:
                return "%+.8E" % st["nplc"]
            want = float(arg)
            st["nplc"] = min((0.3, 1, 10), key=lambda p: abs(p - want))
        elif sub == "NULL:STAT":
            if query:
                return "1" if st["null"] else "0"
            st["null"] = arg in ("ON", "1")
        elif sub == "NULL:VAL":
            if query:
                return "%+.8E" % st["nullv"]
            st["nullv"] = float(arg)
        elif sub == "BAND":
            if query:
                return "%gHz" % self.band
            self.band = float(arg)
        elif sub == "APER":
            if query:
                return "%+.8E" % self.aper
            self.aper = float(arg)
        return None


METER = Meter()


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        print("client connected", self.client_address)
        for raw in self.rfile:
            reply = METER.handle(raw.decode(errors="replace"))
            if reply is not None:
                # NPLC 10 on a real meter takes ~200 ms per reading; keep it snappy.
                if reply and raw.strip().upper() == b"READ?":
                    time.sleep(0.02)
                self.wfile.write((reply + "\n").encode())
        print("client disconnected")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=5025)
    args = ap.parse_args()
    with Server(("127.0.0.1", args.port), Handler) as srv:
        print("simulated SDM3045X on 127.0.0.1:%d" % args.port)
        srv.serve_forever()
