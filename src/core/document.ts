import { type IsoDocument, parseIsoJson } from "./model";
import { createDrawing } from "./drawing";
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

/** Editable AutoCAD R2000 primitives plus the same semantic XRECORD as legacy CAD. */
export function isometricDxf(doc: IsoDocument): string {
  const out: string[] = [],
    put = (...pairs: Array<string | number>) => {
      out.push(...pairs.map(String));
    };
  let handle = 0x100;
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
    4,
    9,
    "$HANDSEED",
    5,
    "FFFFF",
    0,
    "ENDSEC",
  );
  const drawing = createDrawing(doc),
    layers = [...new Set(drawing.primitives.map((p) => p.layer))];
  put(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, layers.length);
  for (const layer of layers)
    put(
      0,
      "LAYER",
      5,
      (handle++).toString(16),
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
  put(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  for (const p of drawing.primitives) {
    put(
      0,
      p.type === "line" ? "LINE" : p.type === "circle" ? "CIRCLE" : "MTEXT",
      5,
      (handle++).toString(16),
      100,
      "AcDbEntity",
      8,
      "BW-ISO-" + p.layer,
    );
    if (p.type === "line")
      put(100, "AcDbLine", 10, p.a[0], 20, -p.a[1], 30, 0, 11, p.b[0], 21, -p.b[1], 31, 0);
    else if (p.type === "circle") put(100, "AcDbCircle", 10, p.p[0], 20, -p.p[1], 30, 0, 40, p.r);
    else {
      const content = p.text.replace(/\\/g, "\\\\").replace(/[{}]/g, "\\$&").replace(/\r?\n/g, "\\P");
      const chunks = content.match(/.{1,240}/gu) ?? [""];
      put(
        100,
        "AcDbMText",
        10,
        p.p[0],
        20,
        -p.p[1] + p.size,
        30,
        0,
        40,
        p.size,
        41,
        Math.max(1, p.text.length * p.size),
        71,
        1,
      );
      for (const [index, chunk] of chunks.entries()) put(index === chunks.length - 1 ? 1 : 3, chunk);
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
