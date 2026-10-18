import { download } from "./download";
export { download };
import { assetUrl } from "./assets";
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  type PDFRef,
  StandardFonts,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  PDFOperator,
  PDFOperatorNames,
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
  setDashPattern,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  stroke,
  TextRenderingMode,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { LINE_SPACING, measureText, strokeText } from "../core/stroke-font";
import { type IsoDocument, bom, validateIso, round, csv, sheetInfoOf } from "../core/model";
import { arcSweep, createDrawing, dashArray, drawingSvg, letteringWeight, weightOf, type Drawing, type Primitive } from "../core/drawing";
import { allowanceText as allowanceLength, sizeText } from "../core/format";
import { packageDrawing, packageDxf, packageSheets, sheetFileName, fileSafe, drawingFileName, type DxfOptions, type PackageSheet } from "../core/document";
import { profileOf } from "../core/profile";
import { zip } from "../core/zip";
import {
  UNKNOWN,
  allowanceText,
  cutCsv,
  cutSchedule,
  cutText,
  overallText,
  lengthUnits,
  materialSchedule,
  pieceText,
  weldCsv,
  weldSchedule,
} from "../core/schedules";

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
  const calloutFont=d.primitives.some(p=>p.type==='text'&&p.lettering==='sans')?await page.doc.embedFont(StandardFonts.Helvetica):font;
  const calloutCharacters=new Set(calloutFont.getCharacterSet());
  // The embedded font's glyph outlines (pdf-lib keeps the fontkit font it embeds), for drawing lettering halos as paths.
  const fontkitFont = (font as unknown as { embedder?: { font?: { unitsPerEm?: number; glyphForCodePoint?: (c: number) => { advanceWidth: number; path: unknown } } } }).embedder?.font;
  const outlines = fontkitFont?.glyphForCodePoint && fontkitFont.unitsPerEm ? (fontkitFont as { unitsPerEm: number; glyphForCodePoint: (c: number) => { advanceWidth: number; path: unknown } }) : undefined;
  const embedded = new Map(
    await Promise.all(
      d.primitives.flatMap((p) => (p.type === "image" ? [p.href] : [])).map(async (href) => [href, await embedImage(page.doc, href)] as const),
    ),
  );
  const hexInk=(hex:string)=>rgb(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255) as [number,number,number]);
  const ops: PDFOperator[] = [];
  const path = (points: Array<[number, number]>, closed = false) => {
    points.forEach((q, i) => ops.push(i ? lineTo(q[0], q[1]) : moveTo(q[0], q[1])));
    if (closed) ops.push(closePath());
  };
  const flush = () => page.pushOperators(...ops.splice(0));
  // Sheet units with y down from here on, so pens are the drawing's own weights. Strokes have round caps and joins, as in the SVG.
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
      const ink = p.color ? hexInk(p.color) : STROKE_INK[p.layer] ?? INK;
      ops.push(pushGraphicsState(), setStrokingColor(ink), setLineWidth(weightOf(p, d.weights)), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round));
      // A linetype is a dash pattern, in sheet units as the SVG draws it.
      const dashes = dashArray(p, d.weights);
      if (dashes) ops.push(setDashPattern(dashes.split(" ").map(Number), 0));
      if (p.type === "line") ops.push(moveTo(p.a[0], p.a[1]), lineTo(p.b[0], p.b[1]), stroke());
      else if (p.type === "arc") {
        // Cubic Béziers of at most 90° each, counter-clockwise on the page (sheet y down).
        const sweep = (arcSweep(p) * Math.PI) / 180,
          pieces = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9)),
          step = sweep / pieces,
          k = (4 / 3) * Math.tan(step / 4),
          [cx, cy] = p.p,
          at = (t: number) => [cx + p.r * Math.cos(t), cy - p.r * Math.sin(t)] as const,
          tangent = (t: number) => [-p.r * Math.sin(t), -p.r * Math.cos(t)] as const;
        let t = (p.start * Math.PI) / 180;
        ops.push(moveTo(...at(t)));
        for (let i = 0; i < pieces; i++, t += step) {
          const [x0, y0] = at(t), [x1, y1] = at(t + step), [u0, v0] = tangent(t), [u1, v1] = tangent(t + step);
          ops.push(appendBezierCurve(x0 + k * u0, y0 + k * v0, x1 - k * u1, y1 - k * v1, x1, y1));
        }
        ops.push(stroke());
      } else if (p.type === "polyline") {
        ops.push(setFillingColor(ink));
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
    const ink = p.color ? hexInk(p.color) : TEXT_INK[p.layer] ?? INK,
      shift = p.anchor === "middle" ? 0.5 : p.anchor === "end" ? 1 : 0;
    if ((p.lettering ?? d.lettering) === "cad") {
      ops.push(
        pushGraphicsState(),
        setStrokingColor(ink),
        setLineWidth(letteringWeight(d.weights)),
        setLineCap(LineCapStyle.Round),
        setLineJoin(LineJoinStyle.Round),
      );
      const strokes = strokeText(p.text, { at: p.p, size: p.size, rotation: p.rotation, oblique: p.oblique, anchor: p.anchor, width: p.width });
      for (const s of strokes) path(s);
      ops.push(...(strokes.length ? [stroke()] : []), popGraphicsState());
      searchable(p, shift);
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
      const textFont=p.lettering==='sans'&&[...line].every(ch=>calloutCharacters.has(ch.codePointAt(0)!))?calloutFont:font;
      const at = { x: -textFont.widthOfTextAtSize(line, size) * shift, y: -row * LINE_SPACING * p.size, size, font:textFont };
      // The SVG's white halo (paint-order: stroke) keeps lettering legible over lines; WELD and BOM text is bold there.
      // It is drawn as the letters' outlines, not as text, so the sheet's text is found and copied once.
      if (p.layer !== "SYMBOL") {
        if (outlines) {
          const outline = haloOutline(line, textFont, at.x, at.y, size);
          if (outline.length) page.pushOperators(setLineWidth(3), setLineJoin(LineJoinStyle.Round), setStrokingColor(WHITE), ...outline, stroke());
        } else {
          // Without outlines (a standard font only), outlined text marked as an artifact, which text extraction skips.
          page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContent, [PDFName.of("Artifact")]), setTextRenderingMode(TextRenderingMode.Outline), setLineWidth(3), setLineJoin(LineJoinStyle.Round), setStrokingColor(WHITE));
          page.drawText(line, { ...at, color: WHITE });
          page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
        }
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
  /**
   * The outlines of a line of lettering as drawn in `textFont` at (x, y) and `size`, as path operators in glyph space
   * (y up). The glyphs are Noto Sans's, the embedded font's; a line set in Helvetica, whose outlines a PDF does not
   * carry, has each Noto glyph fitted to the Helvetica glyph's advance (the halo is far wider than where they differ).
   */
  function haloOutline(line: string, textFont: PDFFont, x: number, y: number, size: number): PDFOperator[] {
    if (!outlines) return [];
    const k = size / outlines.unitsPerEm, own = textFont === font, out: PDFOperator[] = [];
    let pen = x;
    for (const ch of line) {
      const glyph = outlines.glyphForCodePoint(ch.codePointAt(0)!), natural = glyph.advanceWidth * k;
      const advance = own ? natural : textFont.widthOfTextAtSize(ch, size), sx = natural > 0 && !own ? advance / natural : 1;
      const at = (i: number, args: number[]): [number, number] => [pen + args[i] * k * sx, y + args[i + 1] * k];
      // TrueType's quadratic pieces as the cubic curves a PDF draws, from the pen's current point.
      let current: [number, number] = [pen, y], start = current;
      for (const { command, args } of (glyph.path as unknown as { commands: Array<{ command: string; args: number[] }> }).commands) {
        if (command === "moveTo") { current = start = at(0, args); out.push(moveTo(...current)); }
        else if (command === "lineTo") { current = at(0, args); out.push(lineTo(...current)); }
        else if (command === "quadraticCurveTo") {
          const q = at(0, args), end = at(2, args), third = (from: [number, number]) => [from[0] + (2 / 3) * (q[0] - from[0]), from[1] + (2 / 3) * (q[1] - from[1])] as const;
          out.push(appendBezierCurve(...third(current), ...third(end), ...end));
          current = end;
        } else if (command === "bezierCurveTo") { const end = at(4, args); out.push(appendBezierCurve(...at(0, args), ...at(2, args), ...end)); current = end; }
        else if (command === "closePath") { out.push(closePath()); current = start; }
      }
      pen += advance;
    }
    return out;
  }
  /**
   * Stroked CAD lettering also as invisible text over the strokes, each line stretched to the stroke lettering's
   * width, so the sheet can be searched, selected and copied.
   */
  function searchable(p: Extract<Primitive, { type: "text" }>, shift: number) {
    const angle = ((p.rotation ?? 0) * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      slant = Math.tan(((p.oblique ?? 0) * Math.PI) / 180),
      size = p.size / 0.72;
    ops.push(pushGraphicsState(), concatTransformationMatrix(cos, -sin, slant * cos - sin, -(slant * sin + cos), p.p[0], p.p[1]));
    flush();
    page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
    p.text.split(/\r?\n/).forEach((line, row) => {
      const natural = font.widthOfTextAtSize(line, size), drawn = measureText(line, p.size, p.width ?? 1);
      if (!line.trim() || !(natural > 0) || !(drawn > 0)) return;
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(drawn / natural, 0, 0, 1, -drawn * shift, -row * LINE_SPACING * p.size));
      try {
        page.drawText(line, { x: 0, y: 0, size, font });
      } catch {
        // A character the embedded font cannot encode leaves that line out of the text layer; the strokes are drawn.
      }
      page.pushOperators(popGraphicsState());
    });
    ops.push(popGraphicsState());
  }
}
/** Page sizes in PDF points, landscape. */
const PAGE_SIZE = {
  letter: [792, 612],
  tabloid: [1224, 792],
  a3: [1190.55, 841.89],
  a4: [841.89, 595.28],
} as const;
/** The PDF package: every spool's sheet in each output view, then the material, cut and weld schedules. */
export async function exportPdf(doc: IsoDocument): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.drawing} - ${doc.title}`);
  pdf.setSubject(doc.title);
  if (doc.drawnBy.trim()) pdf.setAuthor(doc.drawnBy.trim());
  pdf.setKeywords([doc.drawing, `Rev ${doc.revision}`, doc.project, doc.customer, "piping isometric"].filter((k) => k.trim()));
  pdf.setCreator("Spoolyard");
  pdf.setProducer("Spoolyard");
  pdf.setCreationDate(new Date());
  pdf.setModificationDate(new Date());
  pdf.registerFontkit(fontkit);
  // Noto Sans is embedded (subset) for all lettering it covers. Sans callouts use Helvetica, a PDF standard-14 font
  // every reader provides, metric-compatible with the Arial the SVG names; characters outside it fall back to Noto.
  const fontResponse = await fetch(assetUrl("fonts/NotoSans-Regular.ttf"));
  if (!fontResponse.ok) throw new Error("PDF font could not load. Please retry.");
  const font = await pdf.embedFont(await fontResponse.arrayBuffer(), {
    subset: true,
  });
  const sheets = packageSheets(doc);
  if (sheets.length > 200)
    throw new Error("This package exceeds 200 drawing sheets. Export a smaller set of spools.");
  const pageSize = PAGE_SIZE[doc.paper ?? "tabloid"].slice() as [number, number];
  const issues = validateIso(doc);
  const bookmarks: Array<{ title: string; page: PDFRef }> = [];
  const title = (page: ReturnType<typeof pdf.addPage>, s: string) =>
    page.drawText(s, {
      x: 32,
      y: page.getHeight() - 35,
      size: 15,
      font,
      color: rgb(0.07, 0.13, 0.2),
    });
  for (const sheet of sheets) {
    const d = packageDrawing(doc, sheet);
    const page = pdf.addPage(pageSize);
    bookmarks.push({ title: sheetTitle(doc, sheet), page: page.ref });
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
  /** Schedules use the package's paper; their columns share its width in the proportions given for letter paper. */
  const [pageWidth, pageHeight] = pageSize,
    left = 32,
    right = pageWidth - 32,
    top = pageHeight - 75;
  /** A schedule: a note on what it lists, column headings, and rows under a heading (a string) for each spool's sheet. */
  function schedule(heading: string, note: string, headers: string[], rows: Array<string[] | string>, letterWidths: number[]) {
    const fit = (right - left) / letterWidths.reduce((a, b) => a + b, 0),
      widths = letterWidths.map((w) => w * fit);
    let page = pdf.addPage(pageSize),
      y = top,
      group = "";
    bookmarks.push({ title: heading, page: page.ref });
    const grey = rgb(0.3, 0.35, 0.4);
    const wrap = (s: string, width: number, size: number): string[] => {
      const lines: string[] = [];
      for (const paragraph of s.split(/\r?\n/)) {
        let line = "";
        // Lines break between words; a word longer than the column breaks where it must.
        for (const word of paragraph.split(/(?<= )/)) {
          if (line && font.widthOfTextAtSize(line + word.trimEnd(), size) > width) {
            lines.push(line.trimEnd());
            line = "";
          }
          for (const char of word) {
            if (line && font.widthOfTextAtSize(line + char, size) > width) {
              lines.push(line);
              line = "";
            }
            line += char;
          }
        }
        lines.push(line.trimEnd());
      }
      return lines;
    };
    function header() {
      let x = left;
      headers.forEach((s, i) => {
        page.drawText(s, { x, y, size: 9, font });
        x += widths[i];
      });
      page.drawLine({ start: { x: left, y: y - 6 }, end: { x: right, y: y - 6 }, thickness: 0.5, color: grey });
      y -= 22;
    }
    function groupHeading(s: string) {
      page.drawText(s, { x: left, y, size: 9, font, color: rgb(0.07, 0.13, 0.2) });
      y -= 18;
    }
    const nextPage = () => {
      page = pdf.addPage(pageSize);
      title(page, `${doc.drawing} - ${heading} (continued)`);
      y = top;
      header();
      if (group) groupHeading(`${group} (continued)`);
    };
    title(page, `${doc.drawing} - ${heading}`);
    for (const line of wrap(note, right - left, 8)) {
      page.drawText(line, { x: left, y: y + 22, size: 8, font, color: grey });
      y -= 11;
    }
    y -= 4;
    header();
    for (const row of rows) {
      if (typeof row === "string") {
        const first = !group;
        group = "";
        if (y < 80) nextPage();
        else if (!first) y -= 6;
        group = row;
        groupHeading(row);
        continue;
      }
      const cells = row.map((s, i) => wrap(s, widths[i] - 8, 8));
      const count = Math.max(...cells.map((c) => c.length));
      // Split exceptionally long imported descriptions across pages without running below the margin.
      for (let first = 0; first < count;) {
        if (y < 50) nextPage();
        const available = Math.max(1, Math.floor((y - 38) / 12)),
          take = Math.min(available, count - first);
        let x = left;
        cells.forEach((lines, i) => {
          lines
            .slice(first, first + take)
            .forEach((line, j) => page.drawText(line, { x, y: y - j * 12, size: 8, font }));
          x += widths[i];
        });
        page.drawLine({ start: { x: left, y: y - (take - 1) * 12 - 7 }, end: { x: right, y: y - (take - 1) * 12 - 7 }, thickness: 0.25, color: rgb(0.8, 0.82, 0.85) });
        y -= Math.max(20, take * 12 + 5);
        first += take;
        if (first < count) nextPage();
      }
    }
  }
  /** Rows under a heading for each spool's sheet. */
  const bySheet = <T extends { spool: string; drawing: string }>(items: T[], row: (item: T) => string[]) =>
    items.flatMap((item, i) => [
      ...(i && items[i - 1].spool === item.spool ? [] : [`SPOOL ${item.spool || "-"} · DRAWING ${item.drawing}`]),
      row(item),
    ]);
  const imperial = doc.units === "imperial";
  // Order rounding and saw kerf are the project's fabrication profile, as the material list applies them.
  const profile = profileOf(doc),
    allowance = (mm: number) => (imperial ? allowanceLength(mm, "imperial") : `${round(mm, 1)} mm`),
    ordering = profile.orderIncrement > 0 ? `the cut rounded up to the next ${imperial && profile.orderIncrement === 25.4 ? "whole inch" : allowance(profile.orderIncrement)}` : "the exact cut";
  schedule(
    "Material schedule",
    `Each sheet's bill of materials, with the item numbers tagged on that sheet. QTY: pipe order length in ${lengthUnits(doc.units)} ` +
      `(${ordering}, with ${allowance(profile.kerf)} saw kerf between pieces of one item); everything else each. ` +
      `${UNKNOWN} = not known.`,
    ["Item", "QTY", "ND", "Description", imperial ? "Weight lb" : "Weight kg", imperial ? "Area ft2" : "Area m2"],
    bySheet(materialSchedule(doc), (r) => [
      String(r.id),
      r.qtyText,
      r.nd,
      r.description,
      r.weightKg == null ? UNKNOWN : String(round(r.weightKg / (imperial ? 0.45359237 : 1))),
      r.areaM2 == null ? UNKNOWN : String(round(r.areaM2 / (imperial ? 0.09290304 : 1), 3)),
    ]),
    [40, 70, 75, 403, 70, 70],
  );
  schedule(
    "Pipe cut schedule",
    `Lengths in ${lengthUnits(doc.units)}. Item: the pipe's item number on its sheet. Overall: between the dimension points on the sheet ` +
      "(fitting centres, valve flange faces, reducer ends); cut = overall - takeouts - root gaps. Ends: BE bevelled, PE plain, TE threaded.",
    ["Item", "ND", "Line / heat", "Overall", "Takeouts", "Root gaps", "Cut", "Ends"],
    bySheet(cutSchedule(doc), (r) => [
      pieceText(r),
      sizeText(r.run.nps),
      r.run.line + (r.run.heat ? " / " + r.run.heat : ""),
      overallText(r.overall, doc.units),
      r.takeouts.map((t) => allowanceText(t, doc.units)).join(" + "),
      r.gaps.map((g) => allowanceText(g, doc.units)).join(" + "),
      cutText(r, doc.units),
      r.ends.join(" / "),
    ]),
    [70, 50, 150, 85, 120, 90, 90, 73],
  );
  schedule(
    "Weld map",
    "Welds numbered in sequence along each spool, as on the sheets. WPS, NDE and welder are completed by the shop.",
    ["Weld", "Type", "Size", "Schedule", "Joint", "Shop / field", "WPS", "NDE %", "Welder"],
    bySheet(weldSchedule(doc), (r) => [r.weld.tag, r.type, r.size, r.schedule, r.joint, r.site, "", "", ""]),
    [60, 95, 75, 65, 120, 70, 85, 60, 98],
  );
  if (issues.length)
    schedule(
      "Data requiring completion",
      "Resolve these before the package is issued for fabrication.",
      ["Issue"],
      issues.map((s) => [s]),
      [720],
    );
  const total = pdf.getPageCount();
  pdf
    .getPages()
    .forEach((page, index) => index >= sheets.length &&
      page.drawText(
        `${doc.drawing.slice(0, 60)} · Rev ${doc.revision.slice(0, 20)} · ${index + 1} / ${total}`,
        { x: 32, y: 10, size: 8, font, color: rgb(0.3, 0.35, 0.4) },
      ),
    );
  outline(pdf, bookmarks);
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
/** A sheet's name in bookmarks and file names: its drawing number, and its view when the package has several. */
function sheetTitle(doc: IsoDocument, sheet: PackageSheet): string {
  const views = doc.outputViews ?? ["iso"];
  return `${sheetInfoOf(doc, sheet.spool).drawingNumber}${sheet.spool ? ` · ${sheet.spool}` : ""}${sheet.sheet ? " · MATERIAL LIST" : views.length > 1 ? ` · ${sheet.view.toUpperCase()}` : ""}`;
}
/** PDF bookmarks (the document outline), one per sheet and schedule, opened beside the pages. */
function outline(pdf: PDFDocument, entries: Array<{ title: string; page: PDFRef }>): void {
  if (!entries.length) return;
  const context = pdf.context,
    root = context.nextRef(),
    refs = entries.map(() => context.nextRef());
  entries.forEach((entry, i) => {
    const item = context.obj({ Title: PDFHexString.fromText(entry.title), Parent: root, Dest: [entry.page, "Fit"] });
    if (i) item.set(PDFName.of("Prev"), refs[i - 1]);
    if (i < refs.length - 1) item.set(PDFName.of("Next"), refs[i + 1]);
    context.assign(refs[i], item);
  });
  context.assign(root, context.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  pdf.catalog.set(PDFName.of("Outlines"), root);
  pdf.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}
/** One sheet's SVG: `spool` (default the whole drawing) in `view`. */
export function exportSvg(doc: IsoDocument, spool = "", view: PackageSheet["view"] = "iso"): void {
  download(`${fileSafe(doc.drawing)}-${fileSafe(spool || "all")}.svg`, drawingSvg(createDrawing(doc, spool, view)), "image/svg+xml");
}
/** Every sheet of the package (each spool in each output view) as SVG or DXF files, matching the PDF's sheets. */
export function sheetFiles(doc: IsoDocument, format: "svg" | "dxf", options: DxfOptions = {}): Array<{ name: string; content: string }> {
  if (format === "dxf") return packageDxf(doc, options).map(({ name, content }) => ({ name, content }));
  return packageSheets(doc).map((sheet) => ({
    name: sheetFileName(doc, sheet, "svg"),
    content: drawingSvg(packageDrawing(doc, sheet)),
  }));
}
/**
 * Download the package's sheets as SVG or DXF: one file for a one-sheet drawing, else a ZIP of one file per sheet,
 * named drawing-spool[-view].
 */
export function exportSheets(doc: IsoDocument, format: "svg" | "dxf", options: DxfOptions = {}): void {
  const files = sheetFiles(doc, format, options);
  if (files.length === 1) download(files[0].name, files[0].content, format === "svg" ? "image/svg+xml" : "application/dxf");
  else download(`${fileSafe(doc.drawing)}-${format}.zip`, new Blob([zip(files) as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
}
/** The editor asks before exporting with open fabrication checks, as for every fabrication output. */
export function exportSchedule(doc: IsoDocument, kind: "cut" | "weld"): void {
  download(`${drawingFileName(doc)}-${kind}.csv`, kind === "cut" ? cutCsv(doc) : weldCsv(doc), "text/csv");
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
