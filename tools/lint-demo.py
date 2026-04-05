#!/usr/bin/env python3
"""
Eigendeck Demo Piece Linter

Validates demo HTML files against the eigendeckDemo contract.
Checks for common issues that cause demos to fail in Eigendeck.

Usage:
    python3 tools/lint-demo.py demos/my-demo.html
    python3 tools/lint-demo.py demos/*.html
"""

import sys
import re
import os
from html.parser import HTMLParser


class DemoLinter:
    def __init__(self, filepath):
        self.filepath = filepath
        self.errors = []
        self.warnings = []
        self.info = []
        self.content = ""

    def error(self, msg):
        self.errors.append(f"  ERROR: {msg}")

    def warn(self, msg):
        self.warnings.append(f"  WARN:  {msg}")

    def note(self, msg):
        self.info.append(f"  INFO:  {msg}")

    def lint(self):
        try:
            with open(self.filepath, "r", encoding="utf-8") as f:
                self.content = f.read()
        except Exception as e:
            self.error(f"Cannot read file: {e}")
            return False

        self.check_basic_structure()
        self.check_html_body_height()
        self.check_hash_parsing()
        self.check_controller()
        self.check_viewports()
        self.check_broadcast_channel()
        self.check_dom_content_loaded()
        self.check_iife()
        self.check_css_prefixing()
        self.check_standalone_fallback()
        self.check_external_scripts()

        return len(self.errors) == 0

    def check_basic_structure(self):
        if "<!DOCTYPE html>" not in self.content and "<!doctype html>" not in self.content:
            self.warn("Missing <!DOCTYPE html> declaration")

        if "<html" not in self.content:
            self.error("Missing <html> tag")

        if "<head" not in self.content:
            self.error("Missing <head> tag")

        if "<body" not in self.content:
            self.error("Missing <body> tag")

        if "<script" not in self.content:
            self.error("No <script> tags found")

    def check_html_body_height(self):
        style_blocks = re.findall(r"<style[^>]*>(.*?)</style>", self.content, re.DOTALL)
        all_css = "\n".join(style_blocks)

        has_html_height = bool(
            re.search(r"html\s*,?\s*body\s*\{[^}]*height\s*:\s*100%", all_css)
            or re.search(r"html\s*\{[^}]*height\s*:\s*100%", all_css)
        )
        has_body_height = bool(
            re.search(r"body\s*\{[^}]*height\s*:\s*100%", all_css)
        )

        if not has_html_height:
            self.error(
                "Missing 'html, body { height: 100% }' — iframe content will "
                "collapse to zero height. Add: html, body { width: 100%; height: 100%; }"
            )
        elif not has_body_height:
            self.warn("html has height:100% but body may not — ensure both have it")

    def check_hash_parsing(self):
        if "location.hash" not in self.content:
            self.error(
                "No location.hash parsing found. Demo must check URL hash for "
                "#role=controller or #piece=NAME"
            )
            return

        if "URLSearchParams" not in self.content:
            self.warn(
                "Consider using URLSearchParams to parse hash: "
                "new URLSearchParams(location.hash.slice(1))"
            )

    def check_controller(self):
        if "'controller'" not in self.content and '"controller"' not in self.content:
            self.error(
                "No controller role handler found. Demo must handle "
                "#role=controller to run headless logic"
            )
            return

        if "broadcastState" not in self.content and "postMessage" not in self.content:
            self.error("Controller doesn't appear to broadcast state")

        if "display" in self.content and "'none'" in self.content:
            self.note("Controller hides body (good)")
        else:
            self.warn(
                "Controller should hide body: document.body.style.display = 'none'"
            )

    def check_viewports(self):
        # Find piece names
        piece_refs = re.findall(
            r"""(?:piece\s*===?\s*['"](\w+)['"]|piece\s*==\s*['"](\w+)['"])""",
            self.content,
        )
        pieces = set()
        for groups in piece_refs:
            for g in groups:
                if g:
                    pieces.add(g)

        if not pieces:
            self.error(
                "No piece viewport handlers found. Demo must handle "
                "#piece=NAME for at least one piece"
            )
        else:
            self.note(f"Found piece viewports: {', '.join(sorted(pieces))}")

    def check_broadcast_channel(self):
        if "BroadcastChannel" not in self.content:
            self.error(
                "No BroadcastChannel found. Controller and viewports must "
                "communicate via BroadcastChannel"
            )
            return

        # Check that channel is used for messaging
        if "onmessage" not in self.content and "addEventListener" not in self.content:
            self.warn("No message listener found on BroadcastChannel")

        # Check for request-state
        if "request-state" not in self.content:
            self.warn(
                "No 'request-state' message found. Viewports should request "
                "initial state on load in case controller already broadcast"
            )

    def check_dom_content_loaded(self):
        if "DOMContentLoaded" in self.content:
            if "readyState" not in self.content:
                self.error(
                    "Uses DOMContentLoaded but doesn't check document.readyState. "
                    "The event may have already fired. Add:\n"
                    "    if (document.readyState === 'loading') {\n"
                    "      document.addEventListener('DOMContentLoaded', setup);\n"
                    "    } else { setup(); }"
                )
            else:
                self.note("Handles DOMContentLoaded race condition (good)")

    def check_iife(self):
        # Check if the main script is wrapped in an IIFE
        script_blocks = re.findall(
            r"<script(?:\s[^>]*)?>(?!\s*$)(.*?)</script>",
            self.content,
            re.DOTALL,
        )
        inline_scripts = [s for s in script_blocks if "eigendeckDemo" in s or "BroadcastChannel" in s]

        for script in inline_scripts:
            stripped = script.strip()
            if stripped.startswith("(function") or stripped.startswith("(()"):
                self.note("Script wrapped in IIFE (good)")
            else:
                self.warn(
                    "Main script not wrapped in IIFE. Wrap in "
                    "(function() { ... })(); to avoid global scope pollution"
                )

    def check_css_prefixing(self):
        style_blocks = re.findall(r"<style[^>]*>(.*?)</style>", self.content, re.DOTALL)
        all_css = "\n".join(style_blocks)

        # Find class selectors
        classes = re.findall(r"\.([\w-]+)\s*\{", all_css)
        # Filter out common/generic names
        generic = {"active", "selected", "hidden", "visible", "container", "wrapper", "btn", "link"}
        unprefixed = [c for c in classes if c in generic]

        if unprefixed:
            self.warn(
                f"Generic CSS class names found: {', '.join(unprefixed)}. "
                "Prefix all classes with a unique demo name (e.g., .ge-graph) "
                "to avoid conflicts"
            )

    def check_standalone_fallback(self):
        # Check if there's handling for when no hash is present
        has_fallback = any([
            "// Standalone" in self.content,
            "// standalone" in self.content,
            "// No role/piece" in self.content,
            "// fallback" in self.content,
            "else {" in self.content and "DOMContentLoaded" in self.content,
        ])
        if not has_fallback:
            self.warn(
                "No standalone fallback detected. Consider handling the case "
                "where the demo is opened directly in a browser (no hash params)"
            )

    def check_external_scripts(self):
        ext_scripts = re.findall(r'<script\s+src="([^"]+)"', self.content)
        if ext_scripts:
            self.note(f"External scripts: {', '.join(ext_scripts)}")
            for src in ext_scripts:
                if not src.startswith("https://"):
                    self.warn(f"External script not using HTTPS: {src}")

    def report(self):
        name = os.path.basename(self.filepath)
        status = "PASS" if not self.errors else "FAIL"
        print(f"\n{'='*60}")
        print(f"  {name} — {status}")
        print(f"{'='*60}")

        for msg in self.errors:
            print(f"\033[31m{msg}\033[0m")
        for msg in self.warnings:
            print(f"\033[33m{msg}\033[0m")
        for msg in self.info:
            print(f"\033[36m{msg}\033[0m")

        total = len(self.errors) + len(self.warnings)
        if total == 0:
            print("  All checks passed!")
        else:
            print(f"\n  {len(self.errors)} error(s), {len(self.warnings)} warning(s)")

        return len(self.errors) == 0


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 tools/lint-demo.py <demo.html> [demo2.html ...]")
        print("\nValidates Eigendeck demo HTML files against the demo-piece contract.")
        sys.exit(1)

    all_passed = True
    for filepath in sys.argv[1:]:
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}")
            all_passed = False
            continue

        linter = DemoLinter(filepath)
        linter.lint()
        if not linter.report():
            all_passed = False

    print()
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
