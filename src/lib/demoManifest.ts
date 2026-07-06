// Demo network manifest. A demo declares which hosts it needs and WHY, in a JSON
// block, so we can (a) GATE its internet — no manifest, no network — and (b)
// SURFACE it in the security panel ("this demo uses api.x for live quotes").
//
//   <script type="application/eigendeck-manifest+json">
//   { "network": [ { "host": "api.stockdata.example", "purpose": "Live stock quotes" } ] }
//   </script>
//
// Declared ≠ granted: the manifest scopes what the demo CAN reach (its declared
// hosts become the injected connect-src allowlist); a host it didn't declare is
// blocked. The global master + per-deck switches still sit on top.

export interface DemoNetEntry { host: string; purpose: string }
export interface DemoManifest { network: DemoNetEntry[] }

const MANIFEST_RE =
  /<script[^>]*type=["']application\/eigendeck-manifest\+json["'][^>]*>([\s\S]*?)<\/script>/i;

/** Parse a demo's manifest from its HTML. Tolerant: null on absent/invalid JSON. */
export function parseDemoManifest(html: string | undefined | null): DemoManifest | null {
  if (!html) return null;
  const m = html.match(MANIFEST_RE);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]) as { network?: unknown };
    const net = Array.isArray(obj?.network) ? obj.network : [];
    const network: DemoNetEntry[] = [];
    for (const e of net as Array<{ host?: unknown; purpose?: unknown }>) {
      if (e && typeof e.host === 'string' && e.host.trim()) {
        network.push({ host: e.host.trim(), purpose: typeof e.purpose === 'string' ? e.purpose : '' });
      }
    }
    return { network };
  } catch { return null; }
}

/** The distinct, VALID hosts a demo declared, or [] if none / no manifest. Invalid
 *  hosts are dropped here too so the injected CSP and the panel never grant them. */
export function manifestHosts(html: string | undefined | null): string[] {
  const m = parseDemoManifest(html);
  if (!m) return [];
  return [...new Set(m.network.map((n) => n.host).filter(isValidManifestHost))];
}

// The manifest is ATTACKER-CONTROLLED (it lives in the demo's HTML), and its hosts
// are interpolated into the injected CSP `<meta content="...">`. So a host must be a
// strict hostname (optionally `*.sub`, optional :port) or a full ws(s)/http(s)
// origin — nothing containing a space, `;`, `"`, `'`, `,`, `<`, `>`, or a bare `*`,
// which would otherwise inject extra CSP directives or break out of the attribute
// and defeat the gate entirely. Anything else is rejected.
const HOSTNAME_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;
const ORIGIN_RE = /^(?:https?|wss?):\/\/(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

/** True iff `h` is a safe declared host (strict hostname or ws(s)/http(s) origin).
 *  Used to filter what the manifest can grant AND what the panel shows as granted. */
export function isValidManifestHost(h: string): boolean {
  return typeof h === 'string' && (ORIGIN_RE.test(h) || HOSTNAME_RE.test(h));
}

/** Map declared hosts to a CSP source list. A bare host → https + secure-ws for it;
 *  a full origin (has a scheme) is used verbatim. Invalid/unsafe hosts are dropped
 *  so they can never inject into the CSP. */
export function hostsToCspSources(hosts: string[]): string {
  const out: string[] = [];
  for (const h of hosts) {
    if (!isValidManifestHost(h)) continue;               // reject injection / wildcards / junk
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) out.push(h); // full origin, verbatim
    else out.push(`https://${h}`, `wss://${h}`);         // bare host → https + wss
  }
  return out.join(' ');
}
