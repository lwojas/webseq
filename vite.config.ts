import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// COOP/COEP headers are not required by this app (webdsp's SharedArrayBuffer support is
// opt-in and unused here), but are harmless to omit; nothing in this config is
// tracker-specific beyond the React plugin and dev server port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
  // webdsp's worklet-url subpath resolves its worklet asset via
  // `new URL('./engine-processor.js', import.meta.url)` (see that package's ARCHITECTURE.md,
  // "Using this as a package") — correct under real ESM resolution, but Vite's dev-time
  // dependency pre-bundling (esbuild optimizeDeps) copies the module into
  // node_modules/.vite/deps/ first, which changes what import.meta.url resolves to and
  // breaks the relative lookup (the worklet then 404s and AudioWorklet.addModule() throws
  // "Unable to load a worklet's module"). Excluding webdsp from pre-bundling keeps it served
  // from its real package location, where the relative URL is correct. Confirmed necessary
  // by actually running this app against the dev server, not assumed.
  optimizeDeps: {
    exclude: ["webdsp", "webdsp/worklet-url", "webdsp/sequencing"],
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
