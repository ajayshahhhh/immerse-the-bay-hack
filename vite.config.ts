import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tsconfigPaths(),
  ],

  // Avoid the warning about large chunk size for code agent
  build: {
    chunkSizeWarningLimit: 10000000,
  },

  server: {
    host: true,

    // This is required to access the dev server from cloud sandbox.
    allowedHosts: true,

    watch: {
      ignored: ["!**/node_modules/@moonlakeai/game-sdk/**"],
    },
    headers: {
      // Ensure WASM files are served with correct MIME type
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },

  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
    include: ["@babylonjs/core", "@babylonjs/materials", "@babylonjs/loaders"],
    force: true,
  },
});
