"""Validate that matplotlib inline PNG arrives as image/png in display_data."""
import asyncio, json, time, uuid
from urllib.parse import urlencode
import requests, websockets

BASE, WS_BASE, TOKEN = "http://127.0.0.1:8888", "ws://127.0.0.1:8888", "spike-token"
SESSION = str(uuid.uuid4())

def q(): return "?" + urlencode({"token": TOKEN})

def msg(t, c):
    return {"header": {"msg_id": str(uuid.uuid4()), "session": SESSION,
                       "username": "spike", "msg_type": t, "version": "5.3",
                       "date": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())},
            "parent_header": {}, "metadata": {}, "content": c,
            "buffers": [], "channel": "shell"}

async def main():
    r = requests.post(f"{BASE}/api/kernels{q()}", json={"name": "spike-py3"},
                      headers={"Authorization": f"token {TOKEN}"}).json()
    kid = r["id"]
    try:
        async with websockets.connect(f"{WS_BASE}/api/kernels/{kid}/channels{q()}",
                                      max_size=None) as ws:
            code = ("import matplotlib\n"
                    "matplotlib.use('Agg')\n"
                    "import matplotlib.pyplot as plt\n"
                    "import numpy as np\n"
                    "fig, ax = plt.subplots(figsize=(4,2))\n"
                    "ax.plot(np.arange(20), np.arange(20)**0.5)\n"
                    "ax.set_title('spike')\n"
                    "from io import BytesIO\n"
                    "import base64\n"
                    "buf = BytesIO(); fig.savefig(buf, format='png'); plt.close(fig)\n"
                    "from IPython.display import Image, display\n"
                    "display(Image(data=buf.getvalue(), format='png'))\n")
            m = msg("execute_request", {"code": code, "silent": False,
                    "store_history": True, "user_expressions": {},
                    "allow_stdin": False, "stop_on_error": True})
            pid = m["header"]["msg_id"]
            await ws.send(json.dumps(m))
            saw_png = False
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                d = json.loads(raw)
                if d.get("parent_header", {}).get("msg_id") != pid: continue
                t = d["header"]["msg_type"]; c = d["content"]
                if t == "display_data":
                    keys = list(c.get("data", {}).keys())
                    print(f"  display_data bundle keys: {keys}")
                    if "image/png" in c["data"]:
                        b64 = c["data"]["image/png"]
                        print(f"  image/png: {len(b64)} chars b64 ({len(b64)*3//4} bytes)")
                        saw_png = True
                elif t == "execute_reply":
                    print(f"  reply: {c['status']}")
                    break
            print(f"\nPNG render: {'PASS' if saw_png else 'FAIL'}")
    finally:
        requests.delete(f"{BASE}/api/kernels/{kid}{q()}",
                        headers={"Authorization": f"token {TOKEN}"})

asyncio.run(main())
