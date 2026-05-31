"""
Tougher JupyterLite test: import numpy, do real work, render a
matplotlib PNG inline. This is what David actually wants on stage —
not just hello world.

Uses the same COOP/COEP server as test_lite.py.
"""
import asyncio
import http.server
import socketserver
import threading
from pathlib import Path
from urllib.parse import quote
from playwright.async_api import async_playwright

PUBLIC = Path("/work/public")
PORT = 5175
SHOT = Path("/work/spike-tools/shots")


class COOPCOEPHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()
    def log_message(self, *a, **kw): pass


def serve():
    handler = lambda *a, **kw: COOPCOEPHandler(*a, directory=str(PUBLIC), **kw)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


CODE = """
import sys
print('Python:', sys.version.split()[0])

import numpy as np
print('numpy:', np.__version__)
arr = np.arange(20)
print('arange(20)**2 sum:', int((arr**2).sum()))

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(4, 2))
ax.plot(arr, arr**0.5, marker='o')
ax.set_title('lite spike — sqrt')
plt.show()

print('LITE_NUMPY_OK')
"""


async def drive(browser_name, pw):
    browser_type = getattr(pw, browser_name)
    browser = await browser_type.launch(headless=True)
    context = await browser.new_context()
    page = await context.new_page()
    msgs = []
    page.on("console", lambda m: msgs.append(f"[{m.type}] {m.text[:300]}"))
    page.on("pageerror", lambda e: msgs.append(f"[err] {str(e)[:300]}"))

    url = (f"http://127.0.0.1:{PORT}/notebook-spike/lite/repl/"
           f"?kernel=python&code={quote(CODE)}")
    print(f"\n=== {browser_name}")
    print(f"    URL length: {len(url)} chars")
    try:
        await page.goto(url, wait_until="networkidle", timeout=120000)
    except Exception as e:
        print(f"    initial goto: {str(e)[:200]}")

    # Wait up to 3 minutes for our sentinel (numpy loads on demand
    # from pyodide-built wheels — first run is slow)
    try:
        await page.wait_for_function(
            "document.body.innerText.includes('LITE_NUMPY_OK')",
            timeout=180000,
        )
        print("    PASS — numpy + matplotlib executed and sentinel printed")
        ok = True
    except Exception as e:
        print(f"    TIMEOUT: {str(e)[:200]}")
        ok = False

    body = await page.inner_text("body")
    for line in body.split("\n"):
        if any(k in line for k in ("Python:", "numpy:", "arange", "sqrt", "OK", "Error")):
            print(f"    >> {line.strip()[:120]}")

    shot = SHOT / f"{browser_name}-lite-numpy.png"
    await page.screenshot(path=str(shot), full_page=True)
    print(f"    screenshot: {shot}")

    interesting = [m for m in msgs if any(k in m.lower()
                   for k in ("error", "warn", "fail", "loaded numpy",
                             "loaded matplotlib"))]
    if interesting:
        print(f"    notable console msgs ({len(interesting)}):")
        for m in interesting[:15]:
            print(f"      {m}")

    await browser.close()
    return ok


async def main():
    httpd = serve()
    try:
        async with async_playwright() as pw:
            results = {}
            for name in ["chromium", "webkit"]:
                try:
                    results[name] = "PASS" if await drive(name, pw) else "FAIL"
                except Exception as e:
                    results[name] = f"ERROR: {str(e)[:150]}"
            print("\n=== summary ===")
            for k, v in results.items():
                print(f"  {k}: {v}")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
