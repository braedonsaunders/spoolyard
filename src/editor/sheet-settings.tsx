import type { Drawing } from "../core/drawing";
import { PAPERS } from "./paper";
import { SCALES } from "./choices";
import { OverridesSection } from "./overrides-settings";
import { DEFAULT_PIPE_WEIGHT_MM, DEFAULT_TEXT_HEIGHT_MM } from "../core/iso/context";
import { Actions, Group, LengthInput, Note, NumberInput, PairHead, Row, Section as KitSection, TextInput as KitTextInput, Toggle } from "./inspector/kit";
import { Fragment, useState, type ReactNode } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { cn } from "./cn";
import { MaterialTableSection, SheetFormatSettings, TemplateFieldRows, setTemplateField } from "./sheet-template-settings";
import {
  clone,
  parseLength,
  plantCoordinate,
  sheetInfoOf,
  styleOf,
  sub,
  titleBlockOf,
  type DrawingStyle,
  type IsoDocument,
  type SheetInfo,
  type TitleBlock,
  type TitleBlockRevision,
  type Vec3,
} from "../core/model";

export type Logo = TitleBlock["logos"][number];
type TitleText = Exclude<keyof TitleBlock, "referenceDrawings" | "conditions" | "revisions" | "logos" | "custom">;
type Condition = keyof TitleBlock["conditions"];

/** Limits enforced by the document validator. */
export const TEXT_LIMIT = 200,
  CONDITION_LIMIT = 40,
  SHEET_LIMIT = 120,
  HEADER_LIMIT = 1000,
  NOTES_LIMIT = 12000,
  MAX_REFERENCES = 5,
  MAX_REVISIONS = 6,
  LOGO_MAX_BYTES = 1_500_000,
  LOGO_MAX_SIDE = 1200;
/** Transparent 1×1 PNG holding the company slot when only a client logo is set; renderers may skip unnamed logos. */
export const BLANK_LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

/** The title block as the document stores it, or as it would be created from the sheet's current header. */
export function titleBlockDraft(doc: IsoDocument): TitleBlock {
  // The pipe spec stays blank so the sheet keeps listing the specs in use until someone types one.
  return doc.titleBlock ?? { ...clone(titleBlockOf(doc)), pipeSpec: "" };
}
/** The document's own title block; older drawings get one carrying their header values. */
export function withTitleBlock(d: IsoDocument): TitleBlock {
  return (d.titleBlock ??= titleBlockDraft(d));
}
const limit = (value: string, max: number, what: string) => {
  if (value.length > max) throw new Error(`${what} is limited to ${max} characters.`);
  return value;
};
export function setTitleField(d: IsoDocument, key: TitleText, value: string) {
  withTitleBlock(d)[key] = limit(value.trim(), TEXT_LIMIT, "Title block text");
}
export function setCondition(d: IsoDocument, row: Condition, column: 0 | 1, value: string) {
  withTitleBlock(d).conditions[row][column] = limit(value.trim(), CONDITION_LIMIT, "A condition");
}
export function setReference(d: IsoDocument, index: number, value: string) {
  const refs = withTitleBlock(d).referenceDrawings;
  if (index >= MAX_REFERENCES) throw new Error(`The title block holds ${MAX_REFERENCES} reference drawings.`);
  refs[index] = limit(value.trim(), TEXT_LIMIT, "A reference drawing");
}
export function removeReference(d: IsoDocument, index: number) {
  withTitleBlock(d).referenceDrawings.splice(index, 1);
}

/** The revision that follows the latest one: 0 → 1, A → B; blank when there is no obvious successor. */
export function nextRevision(revisions: TitleBlockRevision[], header = ""): string {
  const last = revisions.at(-1)?.rev.trim();
  if (last == null) return header.trim() || "A";
  if (/^\d+$/.test(last)) return String(Number(last) + 1);
  if (/^[A-Ya-y]$/.test(last)) return String.fromCharCode(last.charCodeAt(0) + 1);
  return "";
}
/** Today as the title block writes dates, YY-MM-DD. */
export function yymmdd(date = new Date()) {
  return [date.getFullYear() % 100, date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
}
// The drawing header's revision follows the latest issued revision.
const syncRevision = (d: IsoDocument, tb: TitleBlock) => {
  const latest = tb.revisions.at(-1)?.rev;
  if (latest) d.revision = latest;
};
export function addRevision(d: IsoDocument, date = yymmdd()) {
  const tb = withTitleBlock(d);
  if (tb.revisions.length >= MAX_REVISIONS) throw new Error(`The title block keeps the last ${MAX_REVISIONS} revisions; remove an old one first.`);
  tb.revisions.push({
    rev: nextRevision(tb.revisions, d.revision),
    date,
    description: "",
    designedBy: tb.designedBy || d.drawnBy,
    checkedBy: tb.checkedBy || d.checkedBy,
    disciplineLead: tb.disciplineLeader,
    projectLeader: tb.projectLeader,
    approvedBy: tb.approvedBy,
  });
  syncRevision(d, tb);
}
export function removeRevision(d: IsoDocument, index: number) {
  const tb = withTitleBlock(d);
  tb.revisions.splice(index, 1);
  syncRevision(d, tb);
}
export function setRevisionField(d: IsoDocument, index: number, key: keyof TitleBlockRevision, value: string) {
  const tb = withTitleBlock(d), row = tb.revisions[index];
  if (!row) throw new Error("That revision no longer exists.");
  row[key] = limit(value.trim(), TEXT_LIMIT, "Revision text");
  syncRevision(d, tb);
}

/** Spools in drawing order; each one is an issued sheet. */
export function sheetSpools(doc: IsoDocument) {
  return [...new Set(doc.runs.map((r) => r.spool))];
}
/** What a spool's sheet prints when it has no values of its own. */
export function defaultSheetInfo(doc: IsoDocument, spool: string) {
  return sheetInfoOf({ ...doc, sheets: undefined }, spool);
}
export function setSheetInfo(d: IsoDocument, spool: string, key: 'drawingNumber' | 'lineNumber' | 'revision', value: string) {
  const v = limit(value.trim(), SHEET_LIMIT, "Sheet text"),
    sheets = (d.sheets ??= {}),
    info: SheetInfo = { ...sheets[spool] };
  if (v) info[key] = v;
  else delete info[key];
  if (Object.keys(info).length) sheets[spool] = info;
  else delete sheets[spool];
  if (!Object.keys(sheets).length) delete d.sheets;
}

export const isBlankLogo = (logo: Logo) => !logo.name && logo.dataUrl === BLANK_LOGO;
/** Company (left panel) and client (right panel) logos. */
export function logoSlots(tb: TitleBlock): [Logo | undefined, Logo | undefined] {
  const real = (logo?: Logo) => (logo && !isBlankLogo(logo) ? logo : undefined);
  return [real(tb.logos[0]), real(tb.logos[1])];
}
export function setLogo(tb: TitleBlock, slot: 0 | 1, logo: Logo | undefined) {
  if (logo) checkLogo(logo.dataUrl);
  const slots = logoSlots(tb);
  slots[slot] = logo;
  tb.logos = slots[1] ? [slots[0] ?? { name: "", dataUrl: BLANK_LOGO }, slots[1]] : slots[0] ? [slots[0]] : [];
}
/** Decoded size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string) {
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}
export function checkLogo(dataUrl: string) {
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error("Logos are stored as PNG or JPEG images.");
  const bytes = dataUrlBytes(dataUrl);
  if (bytes > LOGO_MAX_BYTES)
    throw new Error(`The logo is ${(bytes / 1e6).toFixed(1)} MB; logos are limited to ${LOGO_MAX_BYTES / 1e6} MB.`);
}
export function logoType(name: string, type: string): "png" | "jpeg" | "svg" | undefined {
  const t = type.toLowerCase(),
    ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (t === "image/png" || (!t && ext === "png")) return "png";
  if (t === "image/jpeg" || t === "image/jpg" || (!t && (ext === "jpg" || ext === "jpeg"))) return "jpeg";
  if (t === "image/svg+xml" || (!t && ext === "svg")) return "svg";
}
/** Whether an upload must be redrawn as a PNG before it can be stored. */
export function needsRaster(type: "png" | "jpeg" | "svg", bytes: number, width: number, height: number) {
  return type === "svg" || Math.max(width, height) > LOGO_MAX_SIDE || bytes > LOGO_MAX_BYTES;
}
/** Pixel size with the long side at most `max`; vector art is also scaled up to it. */
export function fitLongSide(width: number, height: number, max = LOGO_MAX_SIDE, upscale = false): [number, number] {
  const k = max / Math.max(width, height, 1e-9),
    s = upscale ? k : Math.min(1, k);
  return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))];
}
/** Intrinsic CSS-pixel size of an SVG from its width, height and viewBox attributes. */
export function svgPixelSize(width?: string | null, height?: string | null, viewBox?: string | null): [number, number] {
  const px = (v?: string | null) => {
    const m = /^\s*(\d*\.?\d+(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(v ?? "");
    if (!m) return;
    const n = Number(m[1]) * ({ px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[m[2]?.toLowerCase() ?? "px"] ?? 1);
    return n > 0 && Number.isFinite(n) ? n : undefined;
  };
  const box = (viewBox ?? "").trim().split(/[\s,]+/).map(Number),
    vw = box.length === 4 && box[2] > 0 ? box[2] : undefined,
    vh = box.length === 4 && box[3] > 0 ? box[3] : undefined;
  let w = px(width),
    h = px(height);
  if (w && !h && vw && vh) h = (w * vh) / vw;
  if (h && !w && vw && vh) w = (h * vw) / vh;
  return [w ?? vw ?? 300, h ?? vh ?? 150];
}

async function readDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("This image could not be read."));
    reader.readAsDataURL(blob);
  });
}
async function withImage<T>(blob: Blob, use: (image: HTMLImageElement) => T): Promise<T> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error("This image could not be read.");
    }
    return use(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}
function rasterise(image: HTMLImageElement, width: number, height: number, upscale: boolean) {
  for (const side of [LOGO_MAX_SIDE, 900, 600]) {
    const [w, h] = fitLongSide(width, height, side, upscale),
      canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("This browser cannot convert images.");
    g.imageSmoothingQuality = "high";
    g.drawImage(image, 0, 0, w, h);
    let url: string;
    try {
      url = canvas.toDataURL("image/png");
    } catch {
      throw new Error("This image cannot be converted here; save it as a PNG and upload that.");
    }
    if (dataUrlBytes(url) <= LOGO_MAX_BYTES) return url;
  }
  throw new Error("This logo is over 1.5 MB even as a small PNG. Use a simpler image.");
}
/** Reads an uploaded logo as a PNG or JPEG data URL, rasterising SVG and oversized images. */
export async function readLogo(file: File): Promise<Logo> {
  const type = logoType(file.name, file.type);
  if (!type) throw new Error("Logos must be PNG, JPEG or SVG images.");
  if (file.size > 30e6) throw new Error("That image is too large for a logo.");
  const name = file.name.slice(0, TEXT_LIMIT) || "Logo";
  if (type === "svg") {
    const svg = new DOMParser().parseFromString(await file.text(), "image/svg+xml").documentElement;
    if (svg.nodeName.toLowerCase() !== "svg" || svg.getElementsByTagName("parsererror").length)
      throw new Error("This SVG could not be read.");
    const [w, h] = svgPixelSize(svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("viewBox")),
      [pw, ph] = fitLongSide(w, h, LOGO_MAX_SIDE, true);
    if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", String(pw));
    svg.setAttribute("height", String(ph));
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    return { name, dataUrl: await withImage(blob, (image) => rasterise(image, pw, ph, false)) };
  }
  const converted = await withImage(file, (image) =>
    needsRaster(type, file.size, image.naturalWidth, image.naturalHeight)
      ? rasterise(image, image.naturalWidth, image.naturalHeight, false)
      : undefined,
  );
  // Stored as uploaded; the prefix is normalised because some systems report no or a non-standard MIME type.
  const raw = converted ?? (await readDataUrl(file)),
    dataUrl = converted ?? `data:image/${type};base64,` + raw.slice(raw.indexOf(",") + 1);
  checkLogo(dataUrl);
  return { name, dataUrl };
}

/** Plant E, N, EL typed in the drawing's units; blanks are zero. */
export function parsePlant(values: string[], units: IsoDocument["units"]): Vec3 {
  return values.map((v) => {
    const mm = v.trim() ? parseLength(v, units, true) : 0;
    if (!(Math.abs(mm) < 1e9)) throw new Error("Enter a plant coordinate within a million metres.");
    return mm;
  }) as Vec3;
}
export function setOrigin(d: IsoDocument, origin: Vec3) {
  if (origin.every((v) => v === 0)) delete d.coordinates;
  else d.coordinates = { origin: [...origin] };
}
/** The model origin that puts a model point at the given plant coordinates. */
export const originFromPoint = (plant: Vec3, position: Vec3): Vec3 => sub(plant, position);

const DIMENSION_MODES: Array<[IsoDocument["dimensionMode"], string]> = [
  ["overall", "Centreline lengths"],
  ["cut", "Cut lengths"],
  ["both", "Both"],
];
const PEOPLE: Array<[TitleText, string]> = [
  ["designedBy", "Designed by"],
  ["date", "Date"],
  ["dateFormat", "Date format"],
  ["checkedBy", "Checked by"],
  ["projectLeader", "Project leader"],
  ["disciplineLeader", "Discipline leader"],
  ["approvedBy", "Approved by"],
];
const SERVICE: Array<[TitleText, string]> = [
  ["insulationThickness", "Insulation thickness"],
  ["insulationCladding", "Insulation cladding"],
  ["tracing", "Tracing"],
];
const SPEC: Array<[TitleText, string]> = [
  ["pipeSpec", "Pipe spec"],
  ["specRevision", "Spec revision"],
  ["designCode", "Design code"],
  ["product", "Product"],
  ["refArea", "Ref. area"],
  ["lineNumber", "Line No. (all sheets)"],
  ["projectNumber", "Project No."],
];
const REVISION_PEOPLE: Array<[keyof TitleBlockRevision, string]> = [
  ["designedBy", "Designed by"],
  ["checkedBy", "Checked by"],
  ["disciplineLead", "Discipline lead"],
  ["projectLeader", "Project leader"],
  ["approvedBy", "Approved by"],
];
const AXES = ["East (E)", "North (N)", "Elevation (EL)"] as const;

/** Drawing setup reads like the rest of the properties panel: the same rows and sections. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <Row label={label}>{children}</Row>;
}
function Section({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return <KitSection id={"sheet." + title} title={title} summary={hint} defaultOpen={open}>{children}</KitSection>;
}
type OnCommit = (value: string) => boolean | void;
/** Commits on blur or Enter, so a typed value is one undo step; Escape restores it. */
function TextInput({
  label,
  value,
  placeholder,
  max = TEXT_LIMIT,
  onCommit,
  onError,
}: {
  label: string;
  value: string;
  placeholder?: string;
  max?: number;
  onCommit: OnCommit;
  onError: (message: string) => void;
}) {
  return (
    <input
      aria-label={label}
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      maxLength={max}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next === value.trim()) return;
        if (next.length > max) {
          e.target.value = value;
          onError(`${label} is limited to ${max} characters.`);
        } else if (onCommit(next) === false) e.target.value = value;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function SheetSettings({
  doc,
  commit,
  onError,
  spool,
  selectedNodeId,
  onUnitsChange,
  drawing,
  onSelectNote,
}: {
  doc: IsoDocument;
  /** The sheet as the editor draws it, for placing new callouts. */
  drawing?: Drawing;
  /** Selects a sheet callout on the sheet, where it is edited. */
  onSelectNote?: (id: string) => void;
  /** Applies an edit through the editor's undo/save flow; returns false if the edit threw. */
  commit: (edit: (d: IsoDocument) => void) => boolean | void;
  onError: (message: string) => void;
  /** Spool currently shown, so per-sheet fields can default to it. */
  spool: string;
  selectedNodeId?: string;
  /** Called after the units change, e.g. to convert lengths the editor holds outside the document. */
  onUnitsChange?: (units: IsoDocument["units"], previous: IsoDocument["units"]) => void;
}) {
  const [busy, setBusy] = useState<0 | 1 | null>(null);
  const style = styleOf(doc),
    draft = titleBlockDraft(doc),
    printed = titleBlockOf(doc),
    spools = sheetSpools(doc),
    logos = logoSlots(draft),
    origin = doc.coordinates?.origin ?? [0, 0, 0],
    node = selectedNodeId ? doc.nodes.find((n) => n.id === selectedNodeId) : undefined,
    metric = doc.units === "mm";
  const edit = (change: (d: IsoDocument) => void) => commit(change) !== false;
  const text = (label: string, value: string, change: (d: IsoDocument, v: string) => void, extra?: { placeholder?: string; max?: number }) => (
    <Field label={label}>
      <TextInput label={label} value={value} {...extra} onError={onError} onCommit={(v) => edit((d) => change(d, v))} />
    </Field>
  );
  const titleText = ([key, label]: [TitleText, string]) =>
    text(label, draft[key] ?? "", (d, v) => setTitleField(d, key, v), {
      placeholder: key === "date" ? draft.dateFormat || "YY-MM-DD" : key === "dateFormat" ? "YY-MM-DD" : printed[key] && printed[key] !== draft[key] ? printed[key] : undefined,
    });
  const setStyle = (change: Partial<DrawingStyle>) => commit((d) => (d.style = { ...styleOf(d), ...change }));
  const upload = async (slot: 0 | 1, input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(slot);
    try {
      const logo = await readLogo(file);
      commit((d) => setLogo(withTitleBlock(d), slot, logo));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="iso-sheet-settings">
      <Section title="Sheet" open>
        {text("Drawing title", doc.title, (d, v) => (d.title = limit(v, HEADER_LIMIT, "The title")), { max: HEADER_LIMIT })}
        {text("Drawing number", doc.drawing, (d, v) => (d.drawing = limit(v, HEADER_LIMIT, "The drawing number")), {
          max: HEADER_LIMIT,
        })}
        <SheetFormatSettings doc={doc} commit={commit} />
        <Field label="Paper size">
          <select aria-label="Paper size" value={doc.paper ?? "tabloid"} onChange={(e) => commit((d) => (d.paper = e.target.value as IsoDocument["paper"]))}>
            {PAPERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Units">
          <select aria-label="Units" value={doc.units}
            onChange={(e) => {
              const units = e.target.value as IsoDocument["units"], previous = doc.units;
              if (edit((d) => (d.units = units))) onUnitsChange?.(units, previous);
            }}>
            <option value="mm">Millimetres</option>
            <option value="imperial">Feet and inches</option>
          </select>
        </Field>
        <Field label="North rotation">
          <NumberInput aria="North rotation" value={doc.north} suffix="°" min={-360} max={360} required onError={onError} onCommit={(v) => v != null && edit((d) => (d.north = v))} />
        </Field>
        <Field label="Dimensions">
          <select aria-label="Dimensions" value={doc.dimensionMode} onChange={(e) => commit((d) => (d.dimensionMode = e.target.value as IsoDocument["dimensionMode"]))}>
            {DIMENSION_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Scale">
          <select aria-label="Scale" value={style.layout} title={SCALES.find((x) => x.value === style.layout)?.title} onChange={(e) => setStyle({ layout: e.target.value as DrawingStyle["layout"] })}>
            {SCALES.map((x) => <option key={x.value} value={x.value} title={x.title}>{x.label}</option>)}
          </select>
        </Field>
        <Field label="Lettering">
          <select aria-label="Lettering" value={style.lettering} onChange={(e) => setStyle({ lettering: e.target.value as DrawingStyle["lettering"] })}>
            <option value="cad">CAD (ROMANS)</option>
            <option value="sans">Sans</option>
          </select>
        </Field>
        <Field label="North symbol">
          <select aria-label="North symbol" value={style.northMark ?? "arrow"} onChange={(e) => setStyle({ northMark: e.target.value as "arrow" | "ticks" })}>
            <option value="arrow">Plant north arrow</option>
            <option value="ticks">Ellipse with compass ticks</option>
          </select>
        </Field>
        <Field label="Lettering height">
          <NumberInput aria="Lettering height on paper" value={style.textHeight} placeholder={String(DEFAULT_TEXT_HEIGHT_MM)} suffix="mm" min={1} max={10} onError={onError}
            onCommit={(v) => setStyle({ textHeight: v })} />
        </Field>
        <Field label="Pipe line weight">
          <NumberInput aria="Pipe line weight on paper" value={style.pipeWeight} placeholder={String(DEFAULT_PIPE_WEIGHT_MM)} suffix="mm" min={0.13} max={2} onError={onError}
            onCommit={(v) => setStyle({ pipeWeight: v })} />
        </Field>
        <Field label="Flanged joint callouts">
          <select aria-label="Flanged joint callouts" value={style.jointCallout ?? "items"} onChange={(e) => setStyle({ jointCallout: e.target.value === "items" ? undefined : "combined" })}>
            <option value="items">A balloon for each item</option>
            <option value="combined">One combined callout (F, B, G)</option>
          </select>
        </Field>
        <Field label="Field-fit welds lettered">
          <select aria-label="Field-fit weld mark" value={style.fieldFitMark ?? "FFW"} onChange={(e) => setStyle({ fieldFitMark: e.target.value === "FFW" ? undefined : "FW" })}>
            <option value="FFW">FFW, with the makeup</option>
            <option value="FW">FW, as a field weld</option>
          </select>
        </Field>
        <Field label="Flanged component gaskets">
          <select aria-label="Gasket dimension span" value={style.gasketSpan ?? "component"}
            title="Which dimension a flanged valve's gaskets are included in. Cut lengths are the same either way."
            onChange={(e) => setStyle({ gasketSpan: e.target.value === "component" ? undefined : "pipe" })}>
            <option value="component">In the component span (mating faces)</option>
            <option value="pipe">In the pipe span (body faces)</option>
          </select>
        </Field>
        <Field label="Flange pair on a fitting">
          <select aria-label="Fitting flange pair gasket span" value={style.fittingGasketSpan ?? "pipe"}
            title="Which dimension the gasket of a flange pair welded straight onto a fitting is included in. Cut lengths are the same either way."
            onChange={(e) => setStyle({ fittingGasketSpan: e.target.value === "pipe" ? undefined : "fitting" })}>
            <option value="pipe">Gasket in the pipe span</option>
            <option value="fitting">Gasket in the fitting make-up</option>
          </select>
        </Field>
        <Field label="Material list">
          <select aria-label="Material list placement" value={style.materialList ?? "auto"}
            title="Automatic: on the drawing sheet, unless it leaves a not-to-scale drawing too little room to be drawn at full size; then on a sheet of its own after the drawing"
            onChange={(e) => setStyle({ materialList: e.target.value === "auto" ? undefined : e.target.value as "onSheet" | "separate" })}>
            <option value="auto">Automatic</option>
            <option value="onSheet">On the drawing sheet</option>
            <option value="separate">On a sheet of its own</option>
          </select>
        </Field>
        <Toggle label="Weld numbers on the sheet" checked={style.weldNumbers} onChange={(on) => setStyle({ weldNumbers: on })} />
        <Toggle label="Centreline elevations at every change of level" checked={!!style.elevations} onChange={(on) => setStyle({ elevations: on })} />
        <Toggle label="Dimension component body faces in a second chain" checked={!!style.componentFaces} onChange={(on) => setStyle({ componentFaces: on })} />
        <Toggle label="Print SCALE: NTS on not-to-scale sheets" checked={style.scaleNote !== false} onChange={(on) => setStyle({ scaleNote: on })} />
        <Toggle label="Stack the line size under the stub-end item tag" checked={!!style.stackSizeLabels} onChange={(on) => setStyle({ stackSizeLabels: on })} />
      </Section>

      <Section title="Sheets" hint={String(spools.length)} open>
        <Note keywords="sheet spool drawing number">{spools.length ? "Each spool is one issued sheet, and a second when its material list has a sheet of its own. Leave a field empty to print the value shown in grey." : "Each spool is one sheet. Sheets appear here once a spool has pipe."}</Note>
        {spools.map((s) => {
          const own = doc.sheets?.[s] ?? {},
            auto = defaultSheetInfo(doc, s);
          const cell = (key: 'drawingNumber' | 'lineNumber' | 'revision', label: string) =>
            text(label, own[key] ?? "", (d, v) => setSheetInfo(d, s, key, v), { placeholder: auto[key], max: SHEET_LIMIT });
          return (
            <Group key={s} title={`${s || "Unassigned"}${s === spool ? " · shown" : ""}`}>
              {cell("drawingNumber", "Drawing No.")}
              {cell("lineNumber", "Line No.")}
              {cell("revision", "Rev.")}
            </Group>
          );
        })}
      </Section>

      <OverridesSection doc={doc} spools={spools} spool={spool} commit={commit} onError={onError} />

      {spools.length > 0 && <MaterialTableSection doc={doc} spool={spools.includes(spool) ? spool : spools[0]} commit={commit} onError={onError} />}

      <Section title="Title block">
        <Group title="Reference drawings">
          {draft.referenceDrawings.map((ref, i) => (
            <Row key={i + ":" + ref} label={`Reference ${i + 1}`} keywords="reference drawing">
              <TextInput label={"Reference drawing " + (i + 1)} value={ref} onError={onError} onCommit={(v) => edit((d) => setReference(d, i, v))} />
              <button type="button" className="insp-reset" aria-label={"Remove reference drawing " + (i + 1)} title="Remove"
                onClick={() => commit((d) => removeReference(d, i))}>
                <Trash2 size={11} />
              </button>
            </Row>
          ))}
          {draft.referenceDrawings.length < MAX_REFERENCES && (
            <Row label={draft.referenceDrawings.length ? "Add another" : "Add reference"} keywords="reference drawing">
              <TextInput key={draft.referenceDrawings.length} label="Add reference drawing" value=""
                placeholder={draft.referenceDrawings.length ? "Reference drawing" : "e.g. P-100-001 Rev.B"} onError={onError}
                onCommit={(v) => edit((d) => setReference(d, withTitleBlock(d).referenceDrawings.length, v))} />
            </Row>
          )}
        </Group>
        <Group title="People and dates">{PEOPLE.map((p) => <Fragment key={p[0]}>{titleText(p)}</Fragment>)}</Group>
        <Group title="Conditions">
          <PairHead columns={[metric ? "Press. (kPa)" : "Press. (psig)", metric ? "Temp. (°C)" : "Temp. (°F)"]} />
          {(["design", "operating", "test"] as const).map((row) => (
            <Row key={row} pair label={row[0].toUpperCase() + row.slice(1)} keywords="condition pressure temperature">
              {([0, 1] as const).map((c) => (
                <TextInput key={c} label={`${row} ${c ? "temperature" : "pressure"}`} value={draft.conditions[row][c]} max={CONDITION_LIMIT}
                  onError={onError} onCommit={(v) => edit((d) => setCondition(d, row, c, v))} />
              ))}
            </Row>
          ))}
        </Group>
        <Group title="Service">{SERVICE.map((s) => <Fragment key={s[0]}>{titleText(s)}</Fragment>)}</Group>
        <Group title="Specification and identity">{SPEC.map((s) => <Fragment key={s[0]}>{titleText(s)}</Fragment>)}</Group>
        <TemplateFieldRows doc={doc} onChange={(key, value) => edit((d) => setTemplateField(withTitleBlock(d), key, value))} />
      </Section>

      <Section title="Revisions" hint={String(draft.revisions.length)}>
        <Note keywords="revision">
          Oldest first. The sheet prints the latest revisions that fit; the newest one is the drawing's revision.
          {!draft.revisions.length && doc.revision && ` Until one is added, revision ${doc.revision} is printed.`}
        </Note>
        {draft.revisions.map((r, i) => {
          const cell = (key: keyof TitleBlockRevision, label: string, placeholder?: string) =>
            text(label, r[key], (d, v) => setRevisionField(d, i, key, v), { placeholder });
          return (
            <Group key={i} title={`Revision ${r.rev || i + 1}${i === draft.revisions.length - 1 ? " · latest" : ""}`}>
              {cell("rev", "Rev.")}
              {cell("date", "Date", draft.dateFormat || "YY-MM-DD")}
              {cell("description", "Description", "Issued for construction")}
              {REVISION_PEOPLE.map(([key, label]) => <Fragment key={key}>{cell(key, label)}</Fragment>)}
              <Actions keywords="revision remove">
                <button type="button" aria-label={"Remove revision " + (r.rev || i + 1)} onClick={() => commit((d) => removeRevision(d, i))}>
                  <Trash2 size={12} /> Remove revision
                </button>
              </Actions>
            </Group>
          );
        })}
        <Actions keywords="revision add">
          <button type="button" disabled={draft.revisions.length >= MAX_REVISIONS} onClick={() => commit((d) => addRevision(d))}>
            <Plus size={12} /> Add revision
          </button>
        </Actions>
      </Section>

      <Section title="Logos" hint={`${logos.filter(Boolean).length} of 2`}>
        {(["Company logo", "Client logo"] as const).map((label, slot) => {
          const logo = logos[slot],
            s = slot as 0 | 1;
          return (
            <Group key={label} title={label}>
              <div className="iso-sheet-logo">
                {logo ? <img src={logo.dataUrl} alt={label} /> : <span>No logo</span>}
              </div>
              {logo && <Note>{logo.name}</Note>}
              <Actions keywords="logo upload">
                <label className={cn("iso-sheet-upload", busy === s && "busy")}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    aria-label={"Upload " + label.toLowerCase()}
                    disabled={busy !== null}
                    onChange={(e) => void upload(s, e.currentTarget)}
                  />
                  <Upload size={12} /> {busy === s ? "Converting…" : logo ? "Replace" : "Upload"}
                </label>
                {logo && (
                  <button type="button" aria-label={"Remove " + label.toLowerCase()} onClick={() => commit((d) => setLogo(withTitleBlock(d), s, undefined))}>
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </Actions>
            </Group>
          );
        })}
        <Note keywords="logo">PNG, JPEG or SVG. SVG and images over 1200 px are converted to PNG; each logo is limited to 1.5 MB. The template decides where each prints.</Note>
      </Section>

      <Section title="Plant coordinates">
        <Note keywords="plant origin coordinates">Plant position of the model origin. Continuation callouts print E/W, N/S and EL from it. A minus is West, South or below datum.</Note>
        {AXES.map((name, i) => (
          <Field key={name} label={name}>
            <LengthInput aria={"Plant " + name} mm={origin[i]} units={doc.units} signed onError={onError}
              title={'Feet and inches or millimetres, e.g. 55\'-2 5/8" or -1200 mm. Minus is West, South or below datum.'}
              onCommit={(v) => { if (v == null) return false; const next = [...origin] as Vec3; next[i] = v; return edit((d) => setOrigin(d, next)); }} />
          </Field>
        ))}
        {node && (
          <Group title={`Set from the selected ${node.tag || "point"}`}>
            <Note>Type the selected point's plant coordinates; the origin is worked out from them.</Note>
            {AXES.map((name, i) => (
              <Field key={name} label={name}>
                <LengthInput aria={"Selected point " + name} mm={plantCoordinate(doc, node.position)[i]} units={doc.units} signed onError={onError}
                  onCommit={(v) => {
                    if (v == null) return false;
                    const plant = [...plantCoordinate(doc, node.position)] as Vec3;
                    plant[i] = v;
                    return edit((d) => setOrigin(d, originFromPoint(plant, node.position)));
                  }} />
              </Field>
            ))}
          </Group>
        )}
      </Section>

      <Section title="Sheet callouts" hint={String((doc.sheetNotes ?? []).filter((n) => n.spool === spool).length)}>
        <Note keywords="callout note markup">Free notes placed on this sheet. Select one on the sheet (or below) to edit it, drag it to move it.</Note>
        {(doc.sheetNotes ?? []).filter((n) => n.spool === spool).map((note) => (
          <Row key={note.id} label={note.text.split("\n")[0].slice(0, 40) || "Callout"} keywords="callout">
            <button type="button" onClick={() => onSelectNote?.(note.id)}>Edit</button>
          </Row>
        ))}
        <Actions keywords="callout add">
          <button type="button" className="is-primary" onClick={() => {
            const [x0, y0, x1, y1] = drawing?.area ?? [0, 0, 0, 0], id = crypto.randomUUID();
            if (edit((d) => { (d.sheetNotes ??= []).push({ id, spool, text: "NOTE", at: [(x0 + x1) / 2, (y0 + y1) / 2] }); })) onSelectNote?.(id);
          }}><Plus size={12} /> Add callout</button>
        </Actions>
      </Section>

      <Section title="General notes" hint={doc.notes.trim() ? String(doc.notes.split(/\r?\n/).filter((l) => l.trim()).length) : undefined}>
        <Row label="Notes" keywords="general notes" stack>
          <KitTextInput aria="General notes" multiline value={doc.notes} maxLength={NOTES_LIMIT} onError={onError}
            placeholder={"All dimensions to be verified on site.\nRemove burrs after cutting."}
            onCommit={(v) => edit((d) => (d.notes = v.replace(/\s+$/, "")))} />
        </Row>
        <Note keywords="notes">{doc.sheetFormat === "classic" ? "One note per line. Long notes continue above the title block." : "One note per line. They print above the title block, numbered automatically."} Ctrl/⌘+Enter finishes editing.</Note>
      </Section>
    </div>
  );
}
