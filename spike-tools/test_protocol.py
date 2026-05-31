"""
Validates the wire protocol used by external-kernel.html:
  POST   /api/kernels                          → start
  WS     /api/kernels/{id}/channels            → exec
  DELETE /api/kernels/{id}                     → stop

Mirrors the JS in the spike so any protocol-level issues surface
in either client.
"""

import asyncio
import json
import sys
import time
import uuid
from urllib.parse import urlencode

import requests
import websockets

BASE = "http://127.0.0.1:8888"
WS_BASE = "ws://127.0.0.1:8888"
TOKEN = "spike-token"
SESSION = str(uuid.uuid4())


def auth_q(extra=None):
    q = {"token": TOKEN}
    if extra:
        q.update(extra)
    return "?" + urlencode(q)


def make_msg(msg_type, content, channel="shell"):
    return {
        "header": {
            "msg_id": str(uuid.uuid4()),
            "session": SESSION,
            "username": "spike",
            "msg_type": msg_type,
            "version": "5.3",
            "date": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        },
        "parent_header": {},
        "metadata": {},
        "content": content,
        "buffers": [],
        "channel": channel,
    }


async def run_cell(ws, code):
    msg = make_msg("execute_request", {
        "code": code,
        "silent": False,
        "store_history": True,
        "user_expressions": {},
        "allow_stdin": False,
        "stop_on_error": True,
    })
    parent_id = msg["header"]["msg_id"]
    await ws.send(json.dumps(msg))

    outputs = []
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=30)
        m = json.loads(raw)
        t = m["header"]["msg_type"]
        pid = m.get("parent_header", {}).get("msg_id")
        if pid != parent_id:
            continue  # ignore status from earlier requests
        ch = m["channel"]
        c = m["content"]
        if t == "stream":
            outputs.append(("stream", c["name"], c["text"]))
        elif t in ("execute_result", "display_data"):
            outputs.append((t, "data", c.get("data", {})))
        elif t == "error":
            outputs.append(("error", c["ename"], c["evalue"]))
        elif t == "execute_reply" and ch == "shell":
            outputs.append(("reply", c["status"], c.get("execution_count")))
            if c["status"] in ("ok", "error", "aborted"):
                return outputs


async def main(kernel_name="python3"):
    print(f"=== start kernel: {kernel_name}")
    r = requests.post(f"{BASE}/api/kernels{auth_q()}",
                      json={"name": kernel_name},
                      headers={"Authorization": f"token {TOKEN}"})
    r.raise_for_status()
    k = r.json()
    kid = k["id"]
    print(f"    id={kid}  name={k['name']}")

    ws_url = f"{WS_BASE}/api/kernels/{kid}/channels{auth_q()}"
    print(f"=== ws connect: {ws_url[:80]}...")
    try:
        async with websockets.connect(ws_url, max_size=None) as ws:
            print("    ws open")

            for code in [
                "print('hello from kernel')",
                "import sys; sys.version",
                "import numpy as np; np.arange(5).tolist()",
                "raise ValueError('intentional')",
                "1/0",
            ]:
                print(f"\n--- exec: {code[:60]}")
                outs = await run_cell(ws, code)
                for kind, *rest in outs:
                    print(f"    {kind}: {rest}")
    finally:
        print(f"\n=== stop kernel {kid}")
        requests.delete(f"{BASE}/api/kernels/{kid}{auth_q()}",
                        headers={"Authorization": f"token {TOKEN}"})


if __name__ == "__main__":
    kn = sys.argv[1] if len(sys.argv) > 1 else "python3"
    asyncio.run(main(kn))
