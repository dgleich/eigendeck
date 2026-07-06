// Enumerate the OPEN deck's demos and surface which ones reach the internet and
// why, for the security window's Internet tab. A demo declares its hosts + purpose
// in a manifest (see demoManifest.ts); this walks the deck, reads each distinct
// demo asset once, and returns the declared network for the ones that use it.
//
// A demo and its pieces share ONE HTML asset (same assetId), so we group by
// assetId — one row per demo document, listing the slides it appears on. Demos
// with no manifest get no internet, so they're not listed here (nothing to show).

import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { parseDemoManifest, type DemoNetEntry } from './demoManifest';

export interface DemoNetReportEntry {
  assetId: string;
  /** 1-based slide numbers where this demo (or its pieces) appears, ascending. */
  slides: number[];
  /** Declared host + purpose pairs (distinct by host). */
  hosts: DemoNetEntry[];
}

/** Read a demo asset's bytes as text (its HTML source). null on any failure. */
async function readAssetText(assetId: string): Promise<string | null> {
  try {
    const buf = await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId });
    return new TextDecoder().decode(new Uint8Array(buf));
  } catch { return null; }
}

/** Distinct hosts, first purpose wins, in declared order. */
function distinctHosts(network: DemoNetEntry[]): DemoNetEntry[] {
  const seen = new Set<string>();
  const out: DemoNetEntry[] = [];
  for (const n of network) {
    if (seen.has(n.host)) continue;
    seen.add(n.host);
    out.push(n);
  }
  return out;
}

/** Build the per-demo internet report for the deck currently in the store. */
export async function buildDemoNetReport(): Promise<DemoNetReportEntry[]> {
  const slides = usePresentationStore.getState().presentation.slides;
  // assetId -> set of 1-based slide numbers it appears on.
  const bySlide = new Map<string, Set<number>>();
  slides.forEach((slide, i) => {
    for (const el of slide.elements) {
      if ((el.type === 'demo' || el.type === 'demo-piece') && el.assetId) {
        if (!bySlide.has(el.assetId)) bySlide.set(el.assetId, new Set());
        bySlide.get(el.assetId)!.add(i + 1);
      }
    }
  });

  const entries = await Promise.all(
    [...bySlide.entries()].map(async ([assetId, slideSet]): Promise<DemoNetReportEntry | null> => {
      const html = await readAssetText(assetId);
      const manifest = parseDemoManifest(html);
      if (!manifest || manifest.network.length === 0) return null;
      return { assetId, slides: [...slideSet].sort((a, b) => a - b), hosts: distinctHosts(manifest.network) };
    }),
  );
  return entries.filter((e): e is DemoNetReportEntry => e !== null)
    .sort((a, b) => a.slides[0] - b.slides[0]);
}
