import { defineConfig } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

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
