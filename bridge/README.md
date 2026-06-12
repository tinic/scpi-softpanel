# SCPI bridge

A thin Python process that owns the single VISA control session to the instrument
and speaks newline-delimited JSON-RPC over stdio to the Node/TS broker. All policy
(polling, state, retries, fan-out) lives in the server; this stays dumb on purpose.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Manual smoke test

```bash
printf '%s\n' \
  '{"id":1,"method":"connect","params":{"resource":"TCPIP::192.168.1.166::INSTR"}}' \
  '{"id":2,"method":"query","params":{"cmd":"READ?"}}' \
  | .venv/bin/python bridge.py
```

You should see a `ready` event, then a `connected` event with the `*IDN?` string,
then the measurement reply.
