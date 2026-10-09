import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base: the same build runs at a site root, under /spoolyard/ in BidWright, on GitHub Pages and in Electron.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", chunkSizeWarningLimit: 2000 },
});
