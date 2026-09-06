import { defineConfig } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
import istanbul from "vite-plugin-istanbul";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const INSTRUMENT = process.env.COVERAGE_INSTRUMENT === "1";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    // E2E coverage spike: with COVERAGE_INSTRUMENT=1 the built bundle is
    // Istanbul-instrumented, so running it in the REAL WebKitGTK app (the e2e
    // Tauri rig) accumulates line hits into window.__coverage__ — engine-agnostic
    // (unlike V8/CDP coverage, which is Chromium-only). Probes extract that global
    // through the seam; the report is merged offline. Off by default → normal
    // builds and `tauri dev` are unaffected.
    ...(INSTRUMENT
      ? [istanbul({
          include: "src/**/*.{ts,tsx}",
          exclude: ["node_modules", "src/test/**", "**/*.test.*", "**/*.d.mts"],
          extension: [".ts", ".tsx"],
          requireEnv: false,
          // The e2e rig serves a `vite build` bundle, not the dev server, so we
          // MUST instrument the production build (off by default in this plugin).
          forceBuildInstrument: true,
        })]
      : []),
  ],

  // Relative asset paths so the packaged Tauri app resolves bundled assets
  // against the loaded HTML (absolute "/assets/..." can blank-screen in the
  // packaged webview). From PR #71 (tunnellm). The other half of that PR —
  // moving UNDO_DEBOUNCE_MS above the store init — is already in main.
  base: './',

  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        presenter: resolve(__dirname, 'presenter.html'),
        security: resolve(__dirname, 'security.html'),
        settings: resolve(__dirname, 'settings.html'),
        'export-cli': resolve(__dirname, 'export-cli.html'),
      },
    },
  },

  // Vitest configuration
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // Coverage (npm run test:coverage). v8 provider; report to terminal + HTML.
    // No hard thresholds yet — establish a baseline first, then ratchet (see #114).
    coverage: {
      provider: "v8",
      // 'json' → coverage/coverage-final.json (istanbul shape) so e2e/coverage-merge.mjs
      // can fold the jsdom unit coverage into the real-WebKit e2e maps for one number.
      reporter: ["text-summary", "text", "html", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx,mjs}"],
      exclude: [
        "src/**/*.test.*",
        "src/**/*.d.mts",
        "src/test/**",
        "src/main.tsx",
        "src/presenter.tsx",
        "src/security.tsx",
      ],
      // Ratcheting floor — CI (and `npm run test:coverage`) FAILS if coverage
      // drops below these. Raise them as tests are added; never lower. Much of
      // the render/interaction layer is covered by the e2e suite (real WebKit),
      // which v8 can't see, so these track the UNIT-testable surface. See #114.
      thresholds: {
        statements: 44,
        branches: 43,
        functions: 43,
        lines: 46,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/examples/**", "**/gitignore/**", "**/*.eigendeck"],
    },
  },
}));
