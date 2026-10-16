import { download } from "./download";
export { download };
import { assetUrl } from "./assets";
import {
  PDFDocument,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  fillAndStroke,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  stroke,
  TextRenderingMode,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { LINE_SPACING, strokeText } from "../core/stroke-font";
import {
  type IsoDocument,
  bom,
  cutCsv,
  weldCsv,
  validateIso,
  round,
  welds,
  csv,
  runResult,
  prepAt,
  formatLength,
  formatAllowance,
  displayBom,
} from "../core/model";
import { createDrawing, drawingSvg, weightOf, type Drawing, type Primitive } from "../core/drawing";

const hex = (value: string) =>
  rgb(...([1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [number, number, number]));
/** Issued sheets are black linework and lettering, like the SVG stylesheet. */
const STROKE_INK: Record<string, Color> = {},
  TEXT_INK: Record<string, Color> = {},
  INK = hex("#111111"),
  WHITE = rgb(1, 1, 1);
const images = new WeakMap<PDFDocument, Map<string, Promise<PDFImage | null>>>();
/** PNG and JPEG data URLs (or fetchable URLs) embed once per document; anything else is left off the page. */
function embedImage(pdf: PDFDocument, href: string): Promise<PDFImage | null> {
  let cache = images.get(pdf);
  if (!cache) images.set(pdf, (cache = new Map()));
  let image = cache.get(href);
  if (!image)
    cache.set(
      href,
      (image = (async () => {
        try {
          const bytes = href.startsWith("data:")
            ? href
            : new Uint8Array(await (await fetch(href)).arrayBuffer());
          const type = typeof bytes === "string" ? /^data:image\/(png|jpe?g)/i.exec(bytes)?.[1]?.toLowerCase()
            : bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpeg" : undefined;
          return type === "png" ? await pdf.embedPng(bytes) : type ? await pdf.embedJpg(bytes) : null;
        } catch {
          return null;
        }
      })()),
    );
  return image;
}

/**
 * Draws a sheet's primitives the way drawingSvg does: `frame` is the page position of the sheet's top-left corner
 * and the page points per sheet unit.
 */
export async function drawPrimitives(
  page: PDFPage,
  d: Drawing,
  font: PDFFont,
  frame: { x: number; y: number; scale: number },
): Promise<void> {
  const embedded = new Map(
    await Promise.all(
      d.primitives.flatMap((p) => (p.type === "image" ? [p.href] : [])).map(async (href) => [href, await embedImage(page.doc, href)] as const),
    ),
  );
  const ops: PDFOperator[] = [];
  const path = (points: Array<[number, number]>, closed = false) => {
    points.forEach((q, i) => ops.push(i ? lineTo(q[0], q[1]) : moveTo(q[0], q[1])));
    if (closed) ops.push(closePath());
  };
  const flush = () => page.pushOperators(...ops.splice(0));
  // Sheet units with y down from here on; stroke widths are in sheet units like the SVG's.
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(frame.scale, 0, 0, -frame.scale, frame.x, frame.y));
  for (const p of d.primitives) {
    if (p.type === "image") {
      const image = embedded.get(p.href);
      if (!image) continue;
      // preserveAspectRatio="xMidYMid meet", upright on the page.
      const fit = Math.min(p.width / image.width, p.height / image.height),
        w = image.width * fit,
        h = image.height * fit;
      ops.push(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, p.p[0], p.p[1] + p.height));
      flush();
      page.drawImage(image, { x: (p.width - w) / 2, y: (p.height - h) / 2, width: w, height: h });
      ops.push(popGraphicsState());
    } else if (p.type === "text") drawText(p);
    else if (p.type !== "polyline" || p.points.length > 1) {
      const ink = STROKE_INK[p.layer] ?? INK;
      ops.push(pushGraphicsState(), setStrokingColor(ink), setLineWidth(weightOf(p)));
      if (p.type === "line") ops.push(moveTo(p.a[0], p.a[1]), lineTo(p.b[0], p.b[1]), stroke());
      else if (p.type === "polyline") {
        ops.push(setLineJoin(LineJoinStyle.Round), setFillingColor(ink));
        path(p.points, p.closed || p.fill);
        ops.push(p.fill ? fillAndStroke() : stroke());
      } else {
        const [x, y] = p.p,
          r = p.r,
          k = r * 0.5523;
        ops.push(
          setFillingColor(p.fill ? ink : WHITE),
          moveTo(x + r, y),
          appendBezierCurve(x + r, y + k, x + k, y + r, x, y + r),
          appendBezierCurve(x - k, y + r, x - r, y + k, x - r, y),
          appendBezierCurve(x - r, y - k, x - k, y - r, x, y - r),
          appendBezierCurve(x + k, y - r, x + r, y - k, x + r, y),
          closePath(),
          fillAndStroke(),
        );
      }
      ops.push(popGraphicsState());
    }
  }
  flush();
  page.pushOperators(popGraphicsState());

  function drawText(p: Extract<Primitive, { type: "text" }>) {
    const ink = TEXT_INK[p.layer] ?? INK,
      shift = p.anchor === "middle" ? 0.5 : p.anchor === "end" ? 1 : 0;
    if (d.lettering === "cad") {
      ops.push(
        pushGraphicsState(),
        setStrokingColor(ink),
        setLineWidth(Math.max(0.35, p.size * 0.1)),
        setLineCap(LineCapStyle.Round),
        setLineJoin(LineJoinStyle.Round),
      );
      const strokes = strokeText(p.text, { at: p.p, size: p.size, rotation: p.rotation, oblique: p.oblique, anchor: p.anchor, width: p.width });
      for (const s of strokes) path(s);
      ops.push(...(strokes.length ? [stroke()] : []), popGraphicsState());
      return;
    }
    // translate(p) rotate(-rotation) skewX(-oblique) in the y-down sheet, then glyph space with y up.
    const angle = ((p.rotation ?? 0) * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      slant = Math.tan(((p.oblique ?? 0) * Math.PI) / 180),
      size = p.size / 0.72;
    ops.push(pushGraphicsState(), concatTransformationMatrix(cos, -sin, slant * cos - sin, -(slant * sin + cos), p.p[0], p.p[1]));
    flush();
    p.text.split(/\r?\n/).forEach((line, row) => {
      const at = { x: -font.widthOfTextAtSize(line, size) * shift, y: -row * LINE_SPACING * p.size, size, font };
      // The SVG's white halo (paint-order: stroke) keeps lettering legible over lines; WELD and BOM text is bold there.
      if (p.layer !== "SYMBOL") {
        page.pushOperators(setTextRenderingMode(TextRenderingMode.Outline), setLineWidth(3), setLineJoin(LineJoinStyle.Round), setStrokingColor(WHITE));
        page.drawText(line, { ...at, color: WHITE });
      }
      const bold = p.layer === "WELD" || p.layer === "BOM";
      page.pushOperators(
        setTextRenderingMode(bold ? TextRenderingMode.FillAndOutline : TextRenderingMode.Fill),
        setLineWidth(size * 0.03),
        setStrokingColor(ink),
      );
      page.drawText(line, { ...at, color: ink });
    });
    ops.push(popGraphicsState());
  }
}
export async function exportPdf(doc: IsoDocument): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.drawing} - ${doc.title}`);
  pdf.setCreator("Spoolyard");
  pdf.registerFontkit(fontkit);
  const fontResponse = await fetch(assetUrl("fonts/NotoSans-Regular.ttf"));
  if (!fontResponse.ok) throw new Error("PDF font could not load. Please retry.");
  const font = await pdf.embedFont(await fontResponse.arrayBuffer(), {
    subset: true,
  });
  const spools = [...new Set(doc.runs.map((r) => r.spool))];
  const pages = spools.length ? spools : [""];
  const views = doc.outputViews ?? ["iso"];
  if (pages.length * views.length > 200)
    throw new Error("This package exceeds 200 drawing sheets. Export a smaller set of spools.");
  const pageSize: [number, number] = (
    {
      letter: [792, 612],
      tabloid: [1224, 792],
      a3: [1190.55, 841.89],
      a4: [841.89, 595.28],
    } as const
  )[doc.paper ?? "tabloid"].slice() as [number, number];
  const issues = validateIso(doc);
  const title = (page: ReturnType<typeof pdf.addPage>, s: string) =>
    page.drawText(s, {
      x: 32,
      y: page.getHeight() - 35,
      size: 15,
      font,
      color: rgb(0.07, 0.13, 0.2),
    });
  for (const spool of pages)
    for (const view of views) {
      const d = createDrawing(doc, spool, view);
      const page = pdf.addPage(pageSize);
      const [width, height] = pageSize;
      // The sheet is laid out at this paper's aspect ratio, so it fills the page edge to edge.
      const scale = Math.min(width / d.width, height / d.height),
        ox = (width - d.width * scale) / 2,
        oy = (height - d.height * scale) / 2;
      // The drafting grid is an editing aid: issued sheets never print it.
      page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
      await drawPrimitives(page, d, font, { x: ox, y: height - oy, scale });
      if (issues.length)
        page.drawText("DRAFT - FABRICATION DATA INCOMPLETE", {
          x: width / 2 - 145,
          y: height - 14,
          size: 11,
          font,
          color: rgb(0.8, 0.1, 0.1),
        });
    }
  function schedule(heading: string, headers: string[], rows: string[][], widths: number[]) {
    let page = pdf.addPage([792, 612]),
      y = 537;
    title(page, `${doc.drawing} - ${heading}`);
    const wrap = (s: string, width: number, size: number): string[] => {
      const lines: string[] = [];
      for (const paragraph of s.split(/\r?\n/)) {
        let line = "";
        for (const char of paragraph) {
          if (line && font.widthOfTextAtSize(line + char, size) > width) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
        lines.push(line);
      }
      return lines;
    };
    function header() {
      let x = 32;
      headers.forEach((s, i) => {
        page.drawText(s, { x, y, size: 9, font });
        x += widths[i];
      });
      y -= 22;
    }
    const nextPage = () => {
      page = pdf.addPage([792, 612]);
      title(page, `${doc.drawing} - ${heading} (continued)`);
      y = 537;
      header();
    };
    header();
    for (const row of rows) {
      const cells = row.map((s, i) => wrap(s, widths[i] - 8, 8));
      const count = Math.max(...cells.map((c) => c.length));
      // Split exceptionally long imported descriptions across pages without running below the margin.
      for (let first = 0; first < count;) {
        if (y < 50) nextPage();
        const available = Math.max(1, Math.floor((y - 38) / 12)),
          take = Math.min(available, count - first);
        let x = 32;
        cells.forEach((lines, i) => {
          lines
            .slice(first, first + take)
            .forEach((line, j) => page.drawText(line, { x, y: y - j * 12, size: 8, font }));
          x += widths[i];
        });
        y -= Math.max(20, take * 12 + 5);
        first += take;
        if (first < count) nextPage();
      }
    }
  }
  schedule(
    "Material schedule",
    ["Item", "Description", "Spec / NPS", "Quantity", doc.units === "imperial" ? "Weight lb" : "Weight kg", doc.units === "imperial" ? "Area ft2" : "Area m2", "Spool / heat"],
    bom(doc).map((r) => {
      const shown = displayBom(r, doc.units);
      return [
      String(r.item),
      r.description,
      `${r.spec} / ${r.nps}"`,
      Number.isFinite(shown.quantity) ? `${round(shown.quantity, 3)} ${shown.unit}` : "Pending cuts",
      shown.weight == null ? "MISSING" : String(round(shown.weight)),
      shown.area == null ? "MISSING" : String(round(shown.area, 3)),
      `${r.spool} / ${r.heat}`,
    ]}),
    [30, 200, 95, 72, 72, 72, 187],
  );
  schedule(
    "Pipe cut schedule",
    ["Pipe / spool", "Line / heat", "NPS", "Overall", "Takeouts / gaps", "Cut length", "Start / end"],
    doc.runs
      .filter((r) => !r.connector)
      .map((r, index) => {
        const v = runResult(doc, r);
        return [
          String(index + 1) + " / " + r.spool,
          r.line + " / " + r.heat,
          String(r.nps),
          formatLength(v.overall, doc.units),
          v.takeouts.map((t) => (Number.isFinite(t) ? formatAllowance(t, doc.units) : "MISSING")).join(" + ") +
            " / " +
            v.gaps.map((g) => formatAllowance(g, doc.units)).join(" + "),
          formatLength(v.cut, doc.units),
          prepAt(r, 0) + " / " + prepAt(r, 1),
        ];
      }),
    [95, 125, 40, 95, 158, 115, 100],
  );
  schedule(
    "Weld map",
    ["Tag", "Spool", "Line", "NPS", "Location", "Prep"],
    welds(doc).map((w) => {
      const r = doc.runs.find((r) => r.id === w.runId)!;
      return [w.tag, r.spool, r.line, String(w.nps), w.field ? "FIELD" : "SHOP", w.prep];
    }),
    [85, 125, 210, 65, 100, 85],
  );
  if (issues.length)
    schedule(
      "Data requiring completion",
      ["Issue"],
      issues.map((s) => [s]),
      [720],
    );
  const total = pdf.getPageCount(), sheets = pages.length * views.length;
  pdf
    .getPages()
    .forEach((page, index) => index >= sheets &&
      page.drawText(
        `${doc.drawing.slice(0, 60)} · Rev ${doc.revision.slice(0, 20)} · ${index + 1} / ${total}`,
        { x: 32, y: 10, size: 8, font, color: rgb(0.3, 0.35, 0.4) },
      ),
    );
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
export function exportSvg(doc: IsoDocument, spool = ""): void {
  download(`${doc.drawing}-${spool || "all"}.svg`, drawingSvg(createDrawing(doc, spool)), "image/svg+xml");
}
export function exportSchedule(doc: IsoDocument, kind: "cut" | "weld"): void {
  if (kind === "cut" && validateIso(doc).length)
    throw new Error("Resolve fabrication checks before exporting the cut list.");
  download(`${doc.drawing}-${kind}.csv`, kind === "cut" ? cutCsv(doc) : weldCsv(doc), "text/csv");
}
export function combinedBomCsv(docs: IsoDocument[]): string {
  const grouped = new Map<string, { row: ReturnType<typeof bom>[number]; drawings: Set<string> }>();
  for (const doc of docs)
    for (const row of bom(doc, "global")) {
      const spec = doc.specs.find((s) => s.id === row.spec)!;
      const key = JSON.stringify([
        row.materialKey ?? "",
        row.description,
        row.spec,
        spec.material,
        spec.schedule,
        spec.rating,
        row.nps,
        row.unit,
        row.heat,
      ]);
      const existing = grouped.get(key);
      if (existing) {
        const r = existing.row;
        r.qty += row.qty;
        r.cost += row.cost;
        r.hours += row.hours;
        r.weightKg = r.weightKg == null || row.weightKg == null ? null : r.weightKg + row.weightKg;
        r.areaM2 = r.areaM2 == null || row.areaM2 == null ? null : r.areaM2 + row.areaM2;
        existing.drawings.add(doc.drawing);
      } else grouped.set(key, { row: { ...row }, drawings: new Set([doc.drawing]) });
    }
  const rows = [...grouped.values()].map(({ row: r, drawings }) => [
    [...drawings].join("; "),
    r.description,
    r.spec,
    r.nps,
    Number.isFinite(r.qty) ? round(r.qty, 3) : "MISSING",
    r.unit,
    r.weightKg == null ? "MISSING" : round(r.weightKg),
    r.areaM2 == null ? "MISSING" : round(r.areaM2, 3),
    round(r.cost),
    round(r.hours),
    r.heat,
  ]);
  return csv([
    [
      "Drawings",
      "Description",
      "Spec",
      "NPS",
      "Quantity",
      "Unit",
      "Weight kg",
      "Area m2",
      "Cost",
      "Labor hours",
      "Heat",
    ],
    ...rows,
  ]);
}
