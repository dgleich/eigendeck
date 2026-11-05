// jsdom (a dependency of the vitest jsdom environment) ships no types, and no
// @types/jsdom matches its version (29). This declares only the part tests use:
// building a separate document whose scripts run, as a demo iframe's would.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options?: { runScripts?: 'dangerously' | 'outside-only' });
    readonly window: Window & typeof globalThis;
  }
}
