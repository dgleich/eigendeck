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

/** The distinct hosts a demo declared, or [] if none / no manifest. */
export function manifestHosts(html: string | undefined | null): string[] {
  const m = parseDemoManifest(html);
  return m ? [...new Set(m.network.map((n) => n.host))] : [];
}

/** Map declared hosts to a CSP source list. A bare host → https + secure-ws for it;
 *  a full origin (has a scheme) is used verbatim. */
export function hostsToCspSources(hosts: string[]): string {
  const out: string[] = [];
  for (const h of hosts) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) out.push(h);
    else out.push(`https://${h}`, `wss://${h}`);
  }
  return out.join(' ');
}
