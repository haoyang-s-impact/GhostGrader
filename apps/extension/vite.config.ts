import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The content script is bundled as a single self-contained IIFE so Chrome can
// load it directly; the manifest is copied verbatim from public/.
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: { content: "src/content/index.tsx" },
      output: { entryFileNames: "[name].js", format: "iife", inlineDynamicImports: true },
    },
  },
});
