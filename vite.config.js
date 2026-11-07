import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The calculation core (src/house-engine.js) also contains the MCP on-disk store,
// so it imports Node built-ins at module level. The browser UI only uses the pure
// functions (evaluateHouse, applyProjectPatch); these aliases swap the built-ins
// for small shims so the same module runs in the Web Worker unchanged.
const shim = (name) => fileURLToPath(new URL(`./src/browser-shims/${name}`, import.meta.url));
const unavailable = shim("node-unavailable.js");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^node:crypto$/, replacement: shim("node-crypto.js") },
      { find: /^node:(child_process|util|fs\/promises|path|url)$/, replacement: unavailable },
    ],
  },
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 2500 },
});
