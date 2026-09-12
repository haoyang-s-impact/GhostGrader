// Bundles each entry on its own: content scripts must be classic IIFEs with
// no shared chunks, while the options page and the service worker can be ES
// modules. Rollup refuses multi-entry IIFE output, hence one build per entry.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const common = (opts) => ({
  plugins: [react()],
  configFile: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  logLevel: "warn",
  build: { outDir: "dist", emptyOutDir: false, sourcemap: false, copyPublicDir: opts.copyPublic ?? false, rollupOptions: { input: opts.input, output: { entryFileNames: `${opts.name}.js`, format: opts.format, inlineDynamicImports: true } } },
});

await build(common({ name: "content", input: "src/content/index.tsx", format: "iife", copyPublic: true }));
await build(common({ name: "page-bridge", input: "src/page-bridge.ts", format: "iife" }));
await build(common({ name: "options", input: "src/options/options.ts", format: "es" }));
await build(common({ name: "background", input: "src/background.ts", format: "es" }));
console.log("extension built into dist/");
