/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to '1' at build time (`VITE_EIGENDECK_SEAM=1 npm run build`) to bake
   *  the `window.__eigendeck` automation seam into the bundle regardless of
   *  the runtime preference. Used for the E2E dist. See src/App.tsx. */
  readonly VITE_EIGENDECK_SEAM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
