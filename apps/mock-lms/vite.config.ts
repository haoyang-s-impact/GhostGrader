import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDist = resolve(here, "../extension/dist");

export default defineConfig({
  // Lets the dev server serve the built extension script for embed mode (?embed=1).
  define: { __GG_EXTENSION_DIST__: JSON.stringify(extensionDist) },
  server: { port: 5173, strictPort: true, fs: { allow: [resolve(here, "../.."), extensionDist] } },
  preview: { port: 5173, strictPort: true },
});
