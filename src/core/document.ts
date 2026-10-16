import { type IsoDocument, parseIsoJson } from "./model";
import { createDrawing, weightOf, LAYER_WEIGHT, type Drawing, type Point } from "./drawing";
import { LINE_SPACING, ROMANS_WIDTH_FACTOR, measureText } from "./stroke-font";
import { importPcf } from "./pcf";

/** Read the original CAD extension record as well as standalone .piping JSON. */
export function readIsometric(content: string): IsoDocument {
  if (content.trimStart().startsWith("{")) return parseIsoJson(content);
  if (/^UNITS-CO-ORDS\s+/mi.test(content) && /^UNITS-BORE\s+/mi.test(content)) return importPcf(content).doc;
  const lines = content.split(/\r?\n/),
    records: Array<Array<[number, string]>> = [];
  let record: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim()),
      value = lines[i + 1].trim();
    if (code === 0) {
      if (record.length) records.push(record);
      record = [];
    }
    record.push([code, value]);
  }
  records.push(record);
  for (const r of records) {
    if (r[0]?.[1] !== "XRECORD") continue;
    const encoded = r
      .filter(([code]) => code === 1)
      .map(([, value]) => value)
      .join("");
    try {
      const value = decodeURIComponent(encoded);
      if (value.includes('"bidwright-piping"')) return parseIsoJson(value);
    } catch {}
  }
  throw new Error(
    "This drawing has no measured piping model. Import a Spoolyard .piping file, a PCF, or a DXF exported by Spoolyard.",
  );
}

/** AutoCAD's standard lineweights, in 1/100 mm. */
const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const PAPER_HEIGHT_MM = { letter: 215.9, tabloid: 279.4, a3: 297, a4: 210 } as const;
/** DXF $INSUNITS codes. */
const INSUNITS = { imperial: 1, mm: 4 } as const;
/** Drafting symbols as TEXT control codes, and the typographic marks the SHX fonts lack as the stroke lettering draws them. */
const DXF_CHARS: Record<string, string> = {
  "°": "%%d", "±": "%%p", "⌀": "%%c", "′": "'", "’": "'", "‘": "'", "″": '"', "“": '"', "”": '"', "–": "-", "—": "-",
  "−": "-", " ": " ", "\t": " ", "½": "1/2", "¼": "1/4", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};
/** A TEXT value: literal %% kept, symbols as control codes, other Unicode as \U+ escapes. */
const dxfText = (s: string) =>
  [...[...s].slice(0, 250).join("").replace(/%%/g, "%%%%%%")]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      return DXF_CHARS[ch] ?? (code < 32 ? "" : code < 127 ? ch : code > 0xffff ? "?" : "\\U+" + code.toString(16).toUpperCase().padStart(4, "0"));
    })
    .join("");

/**
 * Editable AutoCAD R2000 primitives of the sheet (or `drawing`) plus the same semantic XRECORD as legacy CAD. The sheet
 * is drawn at 1:1 on its paper, in inches for imperial drawings and millimetres for metric ones, with its lower-left
 * corner at the origin, so it plots and references at full size. Dimensions are lines and text, as drawn.
 */
export function isometricDxf(doc: IsoDocument, drawing: Drawing = createDrawing(doc)): string {
  const out: string[] = [],
    put = (...pairs: Array<string | number>) => {
      out.push(...pairs.map(String));
    };
  let handle = 0x100;
  const next = () => (handle++).toString(16).toUpperCase();
  // Sheet units to paper units, and the sheet's y-down points to the drawing's y-up plane.
  const paperMm = PAPER_HEIGHT_MM[doc.paper ?? "tabloid"], k = paperMm / (doc.units === "imperial" ? 25.4 : 1) / drawing.height,
    paper = (v: number) => Number((v * k).toFixed(6)),
    X = (x: number) => paper(x),
    Y = (y: number) => paper(drawing.height - y),
    width = paper(drawing.width),
    height = paper(drawing.height);
  put(
    0,
    "SECTION",
    2,
    "HEADER",
    9,
    "$ACADVER",
    1,
    "AC1015",
    9,
    "$INSUNITS",
    70,
    INSUNITS[doc.units],
    9,
    "$MEASUREMENT",
    70,
    doc.units === "imperial" ? 0 : 1,
    9,
    "$LIMMIN",
    10,
    0,
    20,
    0,
    9,
    "$LIMMAX",
    10,
    width,
    20,
    height,
    9,
    "$EXTMIN",
    10,
    0,
    20,
    0,
    30,
    0,
    9,
    "$EXTMAX",
    10,
    width,
    20,
    height,
    30,
    0,
    9,
    "$LWDISPLAY",
    290,
    1,
    9,
    "$HANDSEED",
    5,
    "FFFFF",
    0,
    "ENDSEC",
  );
  const cad = drawing.lettering === "cad",
    layers = [...new Set([...drawing.primitives.map((p) => p.layer), ...(drawing.primitives.some((p) => p.type === "image") ? ["TITLE"] : [])])];
  // Sheet units to the nearest standard lineweight on the printed paper.
  const mm = paperMm / drawing.height,
    lineweight = (w: number) =>
      LINEWEIGHTS.reduce((best, v) => (Math.abs(v - w * mm * 100) < Math.abs(best - w * mm * 100) ? v : best));
  put(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 5, next(), 100, "AcDbSymbolTable", 70, layers.length);
  for (const layer of layers)
    put(
      0,
      "LAYER",
      5,
      next(),
      100,
      "AcDbSymbolTableRecord",
      100,
      "AcDbLayerTableRecord",
      2,
      "BW-ISO-" + layer,
      70,
      0,
      62,
      7,
      6,
      "CONTINUOUS",
    );
  put(0, "ENDTAB", 0, "TABLE", 2, "STYLE", 5, next(), 100, "AcDbSymbolTable", 70, 2);
  // ROMANS at width factor 0.8 is the single-stroke lettering every other output draws.
  for (const [name, font, factor] of [["STANDARD", "txt", 1], ["ROMANS", "romans.shx", ROMANS_WIDTH_FACTOR]] as const)
    put(0, "STYLE", 5, next(), 100, "AcDbSymbolTableRecord", 100, "AcDbTextStyleTableRecord", 2, name, 70, 0, 40, 0, 41, factor, 50, 0, 71, 0, 42, 2.5, 3, font, 4, "");
  put(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  const entity = (type: string, layer: string, weight?: number) =>
    put(0, type, 5, next(), 100, "AcDbEntity", 8, "BW-ISO-" + layer, ...(weight == null ? [] : [370, lineweight(weight)]));
  const polyline = (points: Point[], closed: boolean, layer: string, weight: number) => {
    entity("LWPOLYLINE", layer, weight);
    put(100, "AcDbPolyline", 90, points.length, 70, closed ? 1 : 0);
    for (const q of points) put(10, X(q[0]), 20, Y(q[1]));
  };
  const hatch = (layer: string, boundary: Array<string | number>, seed: Point) => {
    entity("HATCH", layer);
    put(100, "AcDbHatch", 10, 0, 20, 0, 30, 0, 210, 0, 220, 0, 230, 1, 2, "SOLID", 70, 1, 71, 0, 91, 1, ...boundary);
    put(97, 0, 75, 0, 76, 1, 98, 1, 10, X(seed[0]), 20, Y(seed[1]));
  };
  /** One TEXT per line, stacked and slanted like the stroke lettering; middle/end text keeps its anchor as the alignment point. */
  const text = (at: Point, value: string, size: number, layer: string, rotation = 0, oblique = 0, anchor = "start", factor = 1) => {
    const angle = (rotation * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      slant = Math.tan((oblique * Math.PI) / 180);
    value.split(/\r?\n/).forEach((line, row) => {
      const content = dxfText(line);
      if (!content.trim()) return;
      const v = row * LINE_SPACING * size,
        base: Point = [at[0] - v * slant * cos + v * sin, at[1] + v * slant * sin + v * cos],
        shift = anchor === "middle" ? 0.5 : anchor === "end" ? 1 : 0,
        width = measureText(line, size, (cad ? 1 : 1 / ROMANS_WIDTH_FACTOR) * factor) * shift,
        start: Point = [base[0] - width * cos, base[1] + width * sin];
      entity("TEXT", layer, Math.max(0.35, size * 0.1));
      put(100, "AcDbText", 10, X(start[0]), 20, Y(start[1]), 30, 0, 40, paper(size), 1, content);
      if (rotation) put(50, ((rotation % 360) + 360) % 360);
      if (cad || factor !== 1) put(41, (cad ? ROMANS_WIDTH_FACTOR : 1) * factor);
      if (oblique) put(51, Math.max(-85, Math.min(85, oblique)));
      put(7, cad ? "ROMANS" : "STANDARD");
      if (shift) put(72, shift === 1 ? 2 : 1, 11, X(base[0]), 21, Y(base[1]), 31, 0);
      put(100, "AcDbText", 73, 0);
    });
  };
  for (const p of drawing.primitives) {
    if (p.type === "line") {
      entity("LINE", p.layer, weightOf(p));
      put(100, "AcDbLine", 10, X(p.a[0]), 20, Y(p.a[1]), 30, 0, 11, X(p.b[0]), 21, Y(p.b[1]), 31, 0);
    } else if (p.type === "polyline") {
      if (p.points.length < 2) continue;
      polyline(p.points, !!(p.closed || p.fill), p.layer, weightOf(p));
      if (p.fill && p.points.length > 2)
        hatch(p.layer, [92, 3, 72, 0, 73, 1, 93, p.points.length, ...p.points.flatMap((q) => [10, X(q[0]), 20, Y(q[1])])], [
          p.points.reduce((s, q) => s + q[0], 0) / p.points.length,
          p.points.reduce((s, q) => s + q[1], 0) / p.points.length,
        ]);
    } else if (p.type === "circle") {
      entity("CIRCLE", p.layer, weightOf(p));
      put(100, "AcDbCircle", 10, X(p.p[0]), 20, Y(p.p[1]), 30, 0, 40, paper(p.r));
      if (p.fill) hatch(p.layer, [92, 1, 93, 1, 72, 2, 10, X(p.p[0]), 20, Y(p.p[1]), 40, paper(p.r), 50, 0, 51, 360, 73, 1], p.p);
    } else if (p.type === "text") text(p.p, p.text, p.size, p.layer, p.rotation, p.oblique, p.anchor, p.width ?? 1);
    else {
      // DXF R2000 cannot embed a raster, so a logo is its frame and name for the drafter to re-attach.
      const [x, y] = p.p,
        name = doc.titleBlock?.logos.find((logo) => logo.dataUrl === p.href)?.name || "LOGO",
        size = Math.max(1, Math.min(p.height * 0.3, (p.width * 0.85) / Math.max(1e-9, measureText(name, 1))));
      polyline([[x, y], [x + p.width, y], [x + p.width, y + p.height], [x, y + p.height]], true, "TITLE", LAYER_WEIGHT.TITLE);
      text([x + p.width / 2, y + (p.height + size) / 2], name, size, "TITLE", 0, 0, "middle");
    }
  }
  put(
    0,
    "ENDSEC",
    0,
    "SECTION",
    2,
    "OBJECTS",
    0,
    "DICTIONARY",
    5,
    "C",
    330,
    "0",
    100,
    "AcDbDictionary",
    281,
    1,
    3,
    "MLIGHT_XRECORD",
    350,
    "D",
  );
  put(0, "DICTIONARY", 5, "D", 330, "C", 100, "AcDbDictionary", 281, 1, 3, "BIDWRIGHT_PIPING_V1", 350, "E");
  put(0, "XRECORD", 5, "E", 330, "D", 100, "AcDbXrecord", 280, 1);
  const encoded = encodeURIComponent(JSON.stringify(doc));
  for (let i = 0; i < encoded.length; i += 240) put(1, encoded.slice(i, i + 240));
  put(0, "ENDSEC", 0, "EOF");
  return out.join("\n") + "\n";
}
