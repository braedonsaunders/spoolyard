import { assetUrl } from "./assets";
import type { IsoDocument } from "../core/model";
import { fileSafe, packageDxf, type DxfOptions } from "../core/document";
import { zip } from "../core/zip";
/** Largest DXF converted in the browser: the WebAssembly writer holds the drawing and its DWG in memory together. */
export const DWG_MAX_BYTES = 25_000_000;
/** Native AutoCAD 2000 DWG, written by the pinned GNU LibreDWG WebAssembly worker. */
export async function exportDwg(dxf: string): Promise<Blob> {
  const bytes = new TextEncoder().encode(dxf);
  if (bytes.byteLength > DWG_MAX_BYTES)
    throw new Error("DWG export is limited to 25 MB of drawing data. Use DXF for larger drawings.");
  const worker = new Worker(assetUrl("dwg-export/worker.js"), {
    type: "module",
  });
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("DWG conversion timed out. Try DXF export.")), 60000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        if (data.error) reject(new Error(data.error));
        else resolve(new Blob([data.bytes], { type: "application/acad" }));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(new Error("DWG writer could not load. Please retry, or export DXF."));
      };
      worker.postMessage(bytes.buffer, [bytes.buffer]);
    });
  } finally {
    worker.terminate();
  }
}
/**
 * Every sheet of the package as DWG, as the PDF has pages: the one DWG of a one-sheet drawing, else a ZIP of one DWG
 * per spool and output view. Returns the file name to save it as.
 */
export async function exportDwgSheets(doc: IsoDocument, options: DxfOptions = {}): Promise<{ name: string; blob: Blob }> {
  const sheets = packageDxf(doc, options);
  const files = [];
  for (const sheet of sheets) files.push({ name: sheet.name.replace(/\.dxf$/, ".dwg"), content: new Uint8Array(await (await exportDwg(sheet.content)).arrayBuffer()) });
  if (files.length === 1) return { name: files[0].name, blob: new Blob([files[0].content], { type: "application/acad" }) };
  return { name: `${fileSafe(doc.drawing)}-dwg.zip`, blob: new Blob([zip(files) as Uint8Array<ArrayBuffer>], { type: "application/zip" }) };
}
