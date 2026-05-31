"""
Load the built JupyterLite dist in a headless browser and run a
cell to confirm Pyodide works at all in WebKit. This is the
"can we even ship a self-contained kernel" check.

Pyodide may require COOP/COEP headers (cross-origin isolation) for
SharedArrayBuffer. We serve with those headers to give it the best
chance.

We use the /repl/ endpoint with ?kernel and ?code query params —
JupyterLite auto-runs the code on load, simplest path to validate
the kernel actually boots and executes.
"""
import asyncio
import http.server
import socketserver
import threading
from pathlib import Path

from playwright.async_api import async_playwright

PUBLIC = Path("/work/public")
PORT = 5174
SHOT_DIR = Path("/work/spike-tools/shots")


class COOPCOEPHandler(http.server.SimpleHTTPRequestHandler):
    """Add cross-origin isolation headers (needed for SharedArrayBuffer
    → Pyodide kernel thread)."""
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # quiet


def serve():
    handler = lambda *a, **kw: COOPCOEPHandler(*a, directory=str(PUBLIC), **kw)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def drive(browser_name, pw):
    browser_type = getattr(pw, browser_name)
    browser = await browser_type.launch(headless=True)
    context = await browser.new_context()
    page = await context.new_page()

    msgs = []
    page.on("console", lambda m: msgs.append(f"[{m.type}] {m.text[:200]}"))
    page.on("pageerror", lambda e: msgs.append(f"[pageerror] {str(e)[:200]}"))

    url = (f"http://127.0.0.1:{PORT}/notebook-spike/lite/repl/"
           f"?kernel=python&code=print(%27hello%20from%20pyodide%27)")
    print(f"\n=== {browser_name}: load {url}")

    try:
        await page.goto(url, wait_until="networkidle", timeout=60000)
    except Exception as e:
        print(f"    initial load: {e}")

    # JupyterLite kernel takes a while to boot — wait up to 90s for our
    # text to appear in the page.
    try:
        await page.wait_for_function(
            "document.body.innerText.includes('hello from pyodide')",
            timeout=90000,
        )
        print("    PASS — 'hello from pyodide' appeared in page")
        ok = True
    except Exception as e:
        print(f"    TIMEOUT waiting for output: {str(e)[:200]}")
        ok = False

    shot = SHOT_DIR / f"{browser_name}-lite.png"
    await page.screenshot(path=str(shot), full_page=True)
    print(f"    screenshot: {shot}")

    if msgs:
        print(f"    console ({len(msgs)} msgs), last 10:")
        for m in msgs[-10:]:
            print(f"      {m}")

    await browser.close()
    return ok


async def main():
    httpd = serve()
    print(f"COOP/COEP server on :{PORT}")
    try:
        async with async_playwright() as pw:
            results = {}
            for name in ["chromium", "webkit"]:
                try:
                    ok = await drive(name, pw)
                    results[name] = "PASS" if ok else "FAIL"
                except Exception as e:
                    results[name] = f"ERROR: {str(e)[:120]}"
            print("\n=== summary ===")
            for k, v in results.items():
                print(f"  {k}: {v}")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
