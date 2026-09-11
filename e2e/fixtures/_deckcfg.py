"""Shared config completion for the e2e deck generators.

`eigendeck-cli import json` now REQUIRES every deck to store its fonts + type
scale (see require_complete_config in src-tauri/src/cli.rs), so a generated
fixture must carry them too. `with_defaults()` fills in only what a generator's
config omits — existing values win — keeping the stamp behaviour-preserving
('lato' IS the app's default font, and DEFAULT_TEXT_SIZES is exactly what an
absent scale resolves to at render).

DEFAULT_TEXT_SIZES mirrors src/lib/textSizes.mjs (the single source in the app);
keep the two in sync (there is a guard test in src/types/presentation.test.ts).
"""

DEFAULT_TEXT_SIZES = {"footnote": 24, "note": 32, "body": 48, "title": 62, "hype": 48}


def with_defaults(config=None):
    """Return `config` with the required fonts + textSizes filled where missing."""
    c = dict(config or {})
    tf, bf = c.get("defaultTitleFont"), c.get("defaultBodyFont")
    c["defaultTitleFont"] = tf or bf or "lato"
    c["defaultBodyFont"] = bf or tf or "lato"
    ts = dict(DEFAULT_TEXT_SIZES)
    ts.update(c.get("textSizes") or {})
    c["textSizes"] = ts
    return c
