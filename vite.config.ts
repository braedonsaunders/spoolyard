import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** The package directory of a bundled module inside node_modules (pnpm's .pnpm store included), or null. */
function packageRoot(id: string): string | null {
  if (id.startsWith("\0")) return null; // Rollup's virtual modules (CommonJS interop helpers).
  const match = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id.replace(/\?.*$/, ""));
  return match && !/[\\/]node_modules[\\/]\.pnpm$/.test(match[1]) ? match[1] : null;
}

/**
 * The minified bundle drops the licence comments of the open-source packages it contains; their notices ship beside
 * it in THIRD-PARTY-NOTICES.txt (the DWG writer and the PDF font carry their own, in dwg-export/ and fonts/).
 */
function thirdPartyNotices(): Plugin {
  return {
    name: "spoolyard-third-party-notices",
    apply: "build",
    generateBundle(_options, bundle) {
      const roots = new Set<string>();
      for (const chunk of Object.values(bundle))
        if (chunk.type === "chunk") for (const id of Object.keys(chunk.modules)) {
          const root = packageRoot(id);
          if (root) roots.add(root);
        }
      const entries = [...roots].map((root) => {
        const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
          name: string; version: string; license?: string; author?: string | { name?: string }; repository?: string | { url?: string }; homepage?: string;
        };
        const file = readdirSync(root).find((f) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f));
        const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
        const source = pkg.homepage ?? (typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url);
        // A few packages publish no licence file; their declared licence, author and source stand in.
        const text = file ? readFileSync(join(root, file), "utf8").trim()
          : `Licensed under ${pkg.license ?? "its own terms"}${author ? `, by ${author}` : ""}. The package publishes no licence file${source ? `; see ${source}` : ""}.`;
        return { title: `${pkg.name} ${pkg.version} (${pkg.license ?? "see licence"})`, text };
      });
      const unique = [...new Map(entries.map((e) => [e.title, e])).values()].sort((a, b) => a.title.localeCompare(b.title));
      this.emitFile({
        type: "asset",
        fileName: "THIRD-PARTY-NOTICES.txt",
        source:
          "Spoolyard is licensed under the GNU Affero General Public License v3.0 only (see LICENSE in its source).\n" +
          "It includes the following open-source packages, under their own licences:\n\n" +
          unique.map((e) => `${"=".repeat(78)}\n${e.title}\n${"=".repeat(78)}\n${e.text}\n`).join("\n"),
      });
    },
  };
}

// Relative base: the same build runs at a site root, under /spoolyard/ in BidWright, on GitHub Pages and in Electron.
// The heavy modules load on demand: three.js with the 3D review, pdf-lib with PDF export, the DWG writer (WebAssembly,
// in public/dwg-export) with DWG export, and the spec library and sample as fetched JSON. React sits in its own chunk
// so a release that changes only Spoolyard's code keeps the browser's cached copy.
export default defineConfig({
  base: "./",
  plugins: [react(), thirdPartyNotices()],
  build: {
    outDir: "dist",
    // Above the largest lazy chunk (pdf-lib with its font subsetter, ~1.2 MB), so a regression in the split shows.
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](\.pnpm[\\/])?(react|react-dom|scheduler)[@\\/]/.test(id)) return "react";
        },
      },
    },
  },
});
