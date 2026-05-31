"""
Drive public/notebook-spike/external-kernel.html in a real browser.
Validates CORS, WS handshake, and the JS in the spike itself —
things the pure-python protocol test can't catch.

Runs against WebKit (closest of the three Playwright browsers to
what Tauri uses on macOS) and Chromium (for comparison).

Prereqs:
  - jupyter server running on 127.0.0.1:8888 with token=spike-token
  - playwright + chromium + webkit installed
"""
import asyncio
import http.server
import socketserver
import threading
from pathlib import Path

from playwright.async_api import async_playwright

PUBLIC = Path("/work/public")
PORT = 5173
SHOT_DIR = Path("/work/spike-tools/shots")
SHOT_DIR.mkdir(exist_ok=True)


def serve():
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(
        *a, directory=str(PUBLIC), **kw)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler)
    httpd.allow_reuse_address = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


async def drive(browser_name, pw):
    browser_type = getattr(pw, browser_name)
    browser = await browser_type.launch(headless=True)
    page = await browser.new_page()

    console_log = []
    page.on("console", lambda m: console_log.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: console_log.append(f"[pageerror] {e}"))

    url = f"http://127.0.0.1:{PORT}/notebook-spike/external-kernel.html"
    print(f"\n=== {browser_name}: load {url}")
    await page.goto(url)
    await page.wait_for_selector("#start")

    # 1. Refresh kernel list
    await page.click("#refresh")
    await page.wait_for_function(
        "document.getElementById('kern').options.length > 0",
        timeout=5000,
    )
    opts = await page.eval_on_selector_all(
        "#kern option", "els => els.map(e => e.value)")
    print(f"    kernelspecs: {opts}")
    assert "python3" in opts, f"no python3 in {opts}"

    # 2. Start kernel
    await page.click("#start")
    await page.wait_for_function(
        "document.getElementById('kstatus').textContent.includes('connected')",
        timeout=10000,
    )
    status = await page.text_content("#kstatus")
    print(f"    kernel status: {status}")

    # 3. Replace the textarea code with something deterministic
    await page.fill("#code",
                    "print('hello browser')\n"
                    "import sys; sys.version")
    await page.click("#run")

    # Wait for output to contain our string
    await page.wait_for_function(
        "document.getElementById('output').innerText.includes('hello browser')",
        timeout=10000,
    )
    out = await page.text_content("#output")
    print(f"    output:\n      {out.replace(chr(10), chr(10)+'      ')}")
    assert "hello browser" in out
    assert "3.11" in out  # sys.version

    # 4. Screenshot for the README
    shot = SHOT_DIR / f"{browser_name}-spike.png"
    await page.screenshot(path=str(shot), full_page=True)
    print(f"    screenshot: {shot}")

    # 5. Capture protocol log for posterity
    log = await page.text_content("#log")
    log_lines = [line for line in log.split("\n") if line.strip()]
    print(f"    protocol log: {len(log_lines)} lines, last:")
    for line in log_lines[-5:]:
        print(f"      {line}")

    # 6. Stop kernel
    await page.click("#stop")
    await page.wait_for_function(
        "document.getElementById('kstatus').textContent === 'no kernel'",
        timeout=5000,
    )

    if console_log:
        print(f"    JS console ({len(console_log)} entries):")
        for line in console_log:
            print(f"      {line}")
    else:
        print("    JS console: clean")

    await browser.close()


async def main():
    httpd = serve()
    print(f"static server on :{PORT}")
    try:
        async with async_playwright() as pw:
            results = {}
            for name in ["chromium", "webkit"]:
                try:
                    await drive(name, pw)
                    results[name] = "PASS"
                except Exception as e:
                    results[name] = f"FAIL: {e}"
                    print(f"    !!! {name} failed: {e}")
            print("\n=== summary ===")
            for k, v in results.items():
                print(f"  {k}: {v}")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
