//! Loopback HTTP shim that hosts ONLY a YouTube `<iframe>`.
//!
//! The packaged app runs at origin `tauri://localhost`, which YouTube's embedded
//! player rejects (it requires a valid http(s) origin/Referer — see
//! docs/youtube-embed-shim.md). This server lets the app present YouTube by
//! framing `http://127.0.0.1:<port>/yt/<token>/<id>`, a page served here whose
//! http origin YouTube accepts. The main app window stays on `tauri://localhost`,
//! so Tauri IPC/capabilities are untouched.
//!
//! Hardening (all enforced below): binds `127.0.0.1` only; a single exact route;
//! a 256-bit unguessable per-launch token in the path; a Host-header allowlist
//! (anti-DNS-rebinding); a strict 11-char YouTube-id allowlist; GET only; NO CORS
//! header (cross-site JS gets an opaque body); a restrictive response CSP +
//! `nosniff` + `no-store`; no filesystem access; a panic-safe handler. The only
//! attacker-influenced input, the id, is validated to `[A-Za-z0-9_-]{11}` before
//! it ever reaches HTML, and the option flags are parsed as strict booleans.

use std::sync::Arc;
use tiny_http::{Header, Method, Response, Server};
use uuid::Uuid;

/// Managed state exposed to the frontend via the `youtube_shim_base` command.
/// `base` is `http://127.0.0.1:<port>/yt/<token>` (empty if the server failed to
/// start — the frontend then falls back to a direct embed). The frontend appends
/// `/<id>?<flags>`.
#[derive(Clone, Default)]
pub struct ShimState {
    pub base: String,
}

/// A real YouTube video id is exactly 11 chars from `[A-Za-z0-9_-]`.
fn valid_youtube_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header")
}

/// `?a=1&b=0` → is `key` set to exactly "1"? Anything else is false.
fn flag(query: &str, key: &str) -> bool {
    query.split('&').any(|kv| {
        let mut it = kv.splitn(2, '=');
        it.next() == Some(key) && it.next() == Some("1")
    })
}

/// Build the real YouTube embed URL from a (validated) id + option flags. Mirrors
/// the YouTube branch of `buildEmbedSrc` (src/lib/videoEmbedParse.mjs), minus
/// `enablejsapi` — that needs a valid http origin the packaged app lacks and is
/// part of why the embed failed in the first place.
fn youtube_embed_url(id: &str, query: &str) -> String {
    let autoplay = flag(query, "autoplay");
    let show_controls = flag(query, "controls") || !autoplay;
    let mut p: Vec<String> = Vec::new();
    if autoplay {
        p.push("autoplay=1".into());
    }
    if flag(query, "mute") {
        p.push("mute=1".into());
    }
    if flag(query, "loop") {
        p.push("loop=1".into());
        p.push(format!("playlist={id}")); // single-video loop needs playlist=id
    }
    p.push(format!("controls={}", if show_controls { 1 } else { 0 }));
    if flag(query, "captions") {
        p.push("cc_load_policy=1".into());
    }
    p.push("rel=0".into());
    format!(
        "https://www.youtube-nocookie.com/embed/{id}?{}",
        p.join("&")
    )
}

/// The one page this server serves: a full-bleed YouTube iframe. `embed_url`
/// contains only the validated 11-char id + our own fixed params, so nothing
/// attacker-controlled reaches the HTML.
fn page(embed_url: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
<meta name=\"referrer\" content=\"strict-origin-when-cross-origin\">\
<style>html,body{{margin:0;height:100%;background:#000}}iframe{{display:block;border:0;width:100%;height:100%}}</style>\
</head><body><iframe src=\"{embed_url}\" \
allow=\"autoplay; encrypted-media; fullscreen; picture-in-picture\" \
allowfullscreen referrerpolicy=\"strict-origin-when-cross-origin\"></iframe></body></html>"
    )
}

/// Start the shim on `127.0.0.1:<ephemeral>`. Returns the [`ShimState`] carrying
/// the base URL with a fresh per-launch token. Spawns a detached handler thread;
/// the server is torn down when the process exits.
pub fn start() -> std::io::Result<ShimState> {
    let server = Server::http("127.0.0.1:0")
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .unwrap_or(0);
    // 256-bit token (two v4 UUIDs), comfortably beyond the 128-bit floor. Held in
    // memory only — never logged, persisted, or placed in argv.
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let allowed_hosts: Arc<[String]> =
        Arc::from(vec![format!("127.0.0.1:{port}"), format!("localhost:{port}")]);
    let route_prefix = format!("/yt/{token}/");
    let base = format!("http://127.0.0.1:{port}/yt/{token}");

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let hosts = allowed_hosts.clone();
            let prefix = route_prefix.clone();
            // Never let a malformed request panic the handler thread / app.
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                handle(request, &hosts, &prefix);
            }));
        }
    });
    Ok(ShimState { base })
}

fn deny(request: tiny_http::Request, code: u16) {
    let _ = request.respond(Response::empty(code));
}

fn handle(request: tiny_http::Request, allowed_hosts: &[String], route_prefix: &str) {
    // GET only.
    if request.method() != &Method::Get {
        return deny(request, 405);
    }
    // Host-header allowlist (anti-DNS-rebinding).
    let host_ok = request.headers().iter().any(|h| {
        h.field.equiv("Host") && allowed_hosts.iter().any(|a| a.as_str() == h.value.as_str())
    });
    if !host_ok {
        return deny(request, 403);
    }
    // Exact route: /yt/<token>/<id>, with an optional ?flags query.
    let url = request.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
    let id = match path.strip_prefix(route_prefix) {
        Some(rest) => rest,
        None => return deny(request, 404),
    };
    if !valid_youtube_id(id) {
        return deny(request, 400);
    }

    let body = page(&youtube_embed_url(id, query));
    let response = Response::from_string(body)
        .with_header(header("Content-Type", "text/html; charset=utf-8"))
        // The shim page's own tight policy: it may frame only YouTube, nothing else.
        .with_header(header(
            "Content-Security-Policy",
            "default-src 'none'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; style-src 'unsafe-inline'; img-src data:",
        ))
        .with_header(header("X-Content-Type-Options", "nosniff"))
        .with_header(header("Cache-Control", "no-store"));
    // Deliberately NO Access-Control-Allow-Origin: a cross-site page that guesses
    // the token still cannot READ the response body.
    let _ = request.respond(response);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_allowlist() {
        assert!(valid_youtube_id("dQw4w9WgXcQ"));
        assert!(valid_youtube_id("aBc-1_dEfGh"));
        assert!(!valid_youtube_id("abc123")); // too short
        assert!(!valid_youtube_id("dQw4w9WgXcQextra")); // too long
        assert!(!valid_youtube_id("abc\"><script")); // injection chars + wrong len
        assert!(!valid_youtube_id("")); // empty
        assert!(!valid_youtube_id("dQw4w9WgX.Q")); // '.' not allowed
    }

    #[test]
    fn flags_parse_strict_boolean() {
        assert!(flag("autoplay=1&mute=1", "autoplay"));
        assert!(flag("autoplay=1&mute=1", "mute"));
        assert!(!flag("autoplay=0", "autoplay"));
        assert!(!flag("autoplay=true", "autoplay")); // only "1" is true
        assert!(!flag("", "autoplay"));
        assert!(!flag("mute=1", "autoplay"));
    }

    #[test]
    fn embed_url_mirrors_buildembedsrc_youtube_branch() {
        // default: no autoplay -> controls shown, rel=0, NO enablejsapi/autoplay
        let u = youtube_embed_url("dQw4w9WgXcQ", "");
        assert_eq!(
            u,
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?controls=1&rel=0"
        );
        assert!(!u.contains("enablejsapi"));
        // autoplay hides controls unless controls=1; loop adds playlist=id
        let u2 = youtube_embed_url("dQw4w9WgXcQ", "autoplay=1&loop=1&mute=1");
        assert!(u2.contains("autoplay=1"));
        assert!(u2.contains("mute=1"));
        assert!(u2.contains("loop=1"));
        assert!(u2.contains("playlist=dQw4w9WgXcQ"));
        assert!(u2.contains("controls=0"));
        // captions
        assert!(youtube_embed_url("dQw4w9WgXcQ", "captions=1").contains("cc_load_policy=1"));
    }

    #[test]
    fn page_contains_only_validated_id() {
        let html = page(&youtube_embed_url("dQw4w9WgXcQ", ""));
        assert!(html.contains("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"));
        assert!(!html.contains("<script"));
    }
}
