import { useState, type ReactNode } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { cn } from "./cn";
import {
  clone,
  lengthInputValue,
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
type TitleText = Exclude<keyof TitleBlock, "referenceDrawings" | "conditions" | "revisions" | "logos">;
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
export function setSheetInfo(d: IsoDocument, spool: string, key: keyof SheetInfo, value: string) {
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

const PAPERS: Array<[NonNullable<IsoDocument["paper"]>, string]> = [
  ["tabloid", "Tabloid · 17 × 11 in"],
  ["letter", "Letter · 11 × 8.5 in"],
  ["a3", "A3 · 420 × 297 mm"],
  ["a4", "A4 · 297 × 210 mm"],
];
const DIMENSION_MODES: Array<[IsoDocument["dimensionMode"], string]> = [
  ["overall", "Centreline lengths"],
  ["cut", "Cut lengths"],
  ["both", "Both"],
];
const PEOPLE: Array<[TitleText, string]> = [
  ["designedBy", "Designed by"],
  ["date", "Date (YY-MM-DD)"],
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
const AXES = ["East (E)", "North (N)", "Elevation (EL)"];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="iso-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Section({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="iso-sheet-section" open={open}>
      <summary>
        {title}
        {hint && <small>{hint}</small>}
      </summary>
      <div className="iso-sheet-section-body">{children}</div>
    </details>
  );
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
}: {
  doc: IsoDocument;
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
    text(label, draft[key], (d, v) => setTitleField(d, key, v), {
      placeholder: key === "date" ? "YY-MM-DD" : printed[key] && printed[key] !== draft[key] ? printed[key] : undefined,
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
  const axis = (i: number) => {
    const shown = lengthInputValue(origin[i], doc.units);
    return (
      <Field label={AXES[i]} key={i}>
        <input
          aria-label={"Plant " + AXES[i]}
          key={shown + ":" + doc.units}
          defaultValue={shown}
          title={'Feet and inches or millimetres, e.g. 55\'-2 5/8" or -1200 mm. Minus is West, South or below datum.'}
          onBlur={(e) => {
            if (e.target.value.trim() === shown) return;
            try {
              const next = [...origin] as Vec3;
              next[i] = parsePlant([e.target.value], doc.units)[0];
              if (Math.abs(next[i] - origin[i]) < 1e-6 || !edit((d) => setOrigin(d, next))) e.target.value = shown;
            } catch (err) {
              e.target.value = shown;
              onError(err instanceof Error ? err.message : String(err));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = shown;
              e.currentTarget.blur();
            }
          }}
        />
      </Field>
    );
  };

  return (
    <div className="iso-sheet-settings">
      <Section title="Sheet" open>
        {text("Drawing title", doc.title, (d, v) => (d.title = limit(v, HEADER_LIMIT, "The title")), { max: HEADER_LIMIT })}
        {text("Drawing number", doc.drawing, (d, v) => (d.drawing = limit(v, HEADER_LIMIT, "The drawing number")), {
          max: HEADER_LIMIT,
        })}
        <Field label="Paper size">
          <select value={doc.paper ?? "tabloid"} onChange={(e) => commit((d) => (d.paper = e.target.value as IsoDocument["paper"]))}>
            {PAPERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Units">
          <select
            value={doc.units}
            onChange={(e) => {
              const units = e.target.value as IsoDocument["units"],
                previous = doc.units;
              if (edit((d) => (d.units = units))) onUnitsChange?.(units, previous);
            }}
          >
            <option value="mm">Millimetres</option>
            <option value="imperial">Feet / inches</option>
          </select>
        </Field>
        <Field label="North rotation (degrees)">
          <input
            aria-label="North rotation"
            inputMode="decimal"
            key={doc.north}
            defaultValue={String(doc.north)}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === String(doc.north)) return;
              const value = Number(raw.replace(/°$/, ""));
              if (!raw || !Number.isFinite(value) || Math.abs(value) > 1e6) {
                e.target.value = String(doc.north);
                onError("Enter the north rotation in degrees, e.g. 90.");
              } else if (!edit((d) => (d.north = value))) e.target.value = String(doc.north);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </Field>
        <Field label="Dimensions">
          <select
            value={doc.dimensionMode}
            onChange={(e) => commit((d) => (d.dimensionMode = e.target.value as IsoDocument["dimensionMode"]))}
          >
            {DIMENSION_MODES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Layout">
          <select value={style.layout} onChange={(e) => setStyle({ layout: e.target.value as DrawingStyle["layout"] })}>
            <option value="schematic">Not to scale (production)</option>
            <option value="scale">To scale (grid)</option>
          </select>
        </Field>
        <Field label="Lettering">
          <select value={style.lettering} onChange={(e) => setStyle({ lettering: e.target.value as DrawingStyle["lettering"] })}>
            <option value="cad">CAD (ROMANS)</option>
            <option value="sans">Sans</option>
          </select>
        </Field>
        <label className="iso-check">
          <input type="checkbox" checked={style.weldNumbers} onChange={(e) => setStyle({ weldNumbers: e.target.checked })} />
          Weld numbers on sheet
        </label>
      </Section>

      <Section title="Sheets" hint={String(spools.length)} open>
        {!spools.length && <p className="iso-help">Each spool is one sheet. Sheets appear here once a spool has pipe.</p>}
        {spools.map((s) => {
          const own = doc.sheets?.[s] ?? {},
            auto = defaultSheetInfo(doc, s);
          const cell = (key: keyof SheetInfo, label: string) =>
            text(label, own[key] ?? "", (d, v) => setSheetInfo(d, s, key, v), { placeholder: auto[key], max: SHEET_LIMIT });
          return (
            <div key={s} className={cn("iso-sheet-card", s === spool && "current")} aria-current={s === spool || undefined}>
              <div className="iso-sheet-card-head">
                <strong>{s || "Unassigned"}</strong>
                {s === spool && <small>Shown</small>}
              </div>
              {cell("drawingNumber", "Drawing No.")}
              <div className="iso-sheet-grid narrow-end">
                {cell("lineNumber", "Line No.")}
                {cell("revision", "Rev.")}
              </div>
            </div>
          );
        })}
        {spools.length > 0 && <p className="iso-help">Leave a box empty to use the value shown in grey.</p>}
      </Section>

      <Section title="Title block">
        <div className="iso-sheet-list">
          <span className="iso-sheet-label">Reference drawings</span>
          {draft.referenceDrawings.map((ref, i) => (
            <div className="iso-sheet-row" key={i + ":" + ref}>
              <TextInput
                label={"Reference drawing " + (i + 1)}
                value={ref}
                onError={onError}
                onCommit={(v) => edit((d) => setReference(d, i, v))}
              />
              <button
                className="iso-sheet-remove"
                aria-label={"Remove reference drawing " + (i + 1)}
                title="Remove"
                onClick={() => commit((d) => removeReference(d, i))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {draft.referenceDrawings.length < MAX_REFERENCES && (
            <TextInput
              key={draft.referenceDrawings.length}
              label="Add reference drawing"
              value=""
              placeholder={draft.referenceDrawings.length ? "Add another" : "e.g. P-100-001 Rev.B"}
              onError={onError}
              onCommit={(v) => edit((d) => setReference(d, withTitleBlock(d).referenceDrawings.length, v))}
            />
          )}
        </div>
        <div className="iso-sheet-grid">{PEOPLE.map((p) => <div key={p[0]}>{titleText(p)}</div>)}</div>
        <div className="iso-sheet-conditions" role="group" aria-label="Conditions">
          <span />
          <span>{metric ? "Press. (kPa)" : "Press. (psig)"}</span>
          <span>{metric ? "Temp. (°C)" : "Temp. (°F)"}</span>
          {(["design", "operating", "test"] as const).map((row) => [
            <span key={row}>{row[0].toUpperCase() + row.slice(1)}</span>,
            ...([0, 1] as const).map((c) => (
              <TextInput
                key={row + c}
                label={`${row} ${c ? "temperature" : "pressure"}`}
                value={draft.conditions[row][c]}
                max={CONDITION_LIMIT}
                onError={onError}
                onCommit={(v) => edit((d) => setCondition(d, row, c, v))}
              />
            )),
          ])}
        </div>
        {SERVICE.map((s) => <div key={s[0]}>{titleText(s)}</div>)}
        <div className="iso-sheet-grid">{SPEC.map((s) => <div key={s[0]}>{titleText(s)}</div>)}</div>
      </Section>

      <Section title="Revisions" hint={String(draft.revisions.length)}>
        <p className="iso-help">
          Oldest first. The sheet prints the latest revisions; the newest one is the drawing's revision.
          {!draft.revisions.length && doc.revision && ` Until one is added, revision ${doc.revision} is printed.`}
        </p>
        {draft.revisions.map((r, i) => {
          const cell = (key: keyof TitleBlockRevision, label: string, placeholder?: string) =>
            text(label, r[key], (d, v) => setRevisionField(d, i, key, v), { placeholder });
          return (
            <div className={cn("iso-sheet-card", i === draft.revisions.length - 1 && "current")} key={i}>
              <div className="iso-sheet-card-head">
                <strong>Revision {r.rev || i + 1}</strong>
                {i === draft.revisions.length - 1 && <small>Latest</small>}
                <button
                  className="iso-sheet-remove"
                  aria-label={"Remove revision " + (r.rev || i + 1)}
                  title="Remove revision"
                  onClick={() => commit((d) => removeRevision(d, i))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="iso-sheet-grid narrow-start">
                {cell("rev", "Rev.")}
                {cell("date", "Date", "YY-MM-DD")}
              </div>
              {cell("description", "Description", "Issued for construction")}
              <div className="iso-sheet-grid">
                {REVISION_PEOPLE.map(([key, label]) => (
                  <div key={key}>{cell(key, label)}</div>
                ))}
              </div>
            </div>
          );
        })}
        <button
          className="iso-primary"
          disabled={draft.revisions.length >= MAX_REVISIONS}
          onClick={() => commit((d) => addRevision(d))}
        >
          <Plus size={13} /> Add revision
        </button>
      </Section>

      <Section title="Logos" hint={`${logos.filter(Boolean).length} of 2`}>
        {(["Company logo", "Client logo"] as const).map((label, slot) => {
          const logo = logos[slot],
            s = slot as 0 | 1;
          return (
            <div className="iso-sheet-card" key={label}>
              <div className="iso-sheet-card-head">
                <strong>{label}</strong>
                <small>{slot ? "Beside revisions" : "Above pipe spec"}</small>
              </div>
              <div className="iso-sheet-logo">
                {logo ? <img src={logo.dataUrl} alt={label} /> : <span>No logo</span>}
              </div>
              {logo && <span className="iso-sheet-file" title={logo.name}>{logo.name}</span>}
              <div className="iso-sheet-actions">
                <label className={cn("iso-sheet-upload", busy === s && "busy")}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    aria-label={"Upload " + label.toLowerCase()}
                    disabled={busy !== null}
                    onChange={(e) => void upload(s, e.currentTarget)}
                  />
                  <Upload size={13} /> {busy === s ? "Converting…" : logo ? "Replace" : "Upload"}
                </label>
                {logo && (
                  <button aria-label={"Remove " + label.toLowerCase()} onClick={() => commit((d) => setLogo(withTitleBlock(d), s, undefined))}>
                    <Trash2 size={13} /> Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <p className="iso-help">PNG, JPEG or SVG. SVG and images over 1200 px are converted to PNG; each logo is limited to 1.5 MB.</p>
      </Section>

      <Section title="Plant coordinates">
        <p className="iso-help">
          Plant position of the model origin. Continuation callouts print E/W, N/S and EL from it. Use a minus sign for
          West, South or below datum.
        </p>
        {[0, 1, 2].map(axis)}
        {node && (
          <form
            className="iso-sheet-card"
            key={node.id + ":" + origin.join(",") + ":" + doc.units}
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              try {
                const plant = parsePlant(["e", "n", "el"].map((k) => String(values.get(k) ?? "")), doc.units);
                edit((d) => setOrigin(d, originFromPoint(plant, node.position)));
              } catch (err) {
                onError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <div className="iso-sheet-card-head">
              <strong>Set from selected point</strong>
            </div>
            <p className="iso-help">Type the plant coordinates of the selected {node.tag || "point"}; the origin is worked out from them.</p>
            {(["e", "n", "el"] as const).map((k, i) => (
              <Field label={AXES[i]} key={k}>
                <input name={k} aria-label={"Selected point " + AXES[i]} defaultValue={lengthInputValue(plantCoordinate(doc, node.position)[i], doc.units)} />
              </Field>
            ))}
            <button className="iso-primary">Set origin</button>
          </form>
        )}
      </Section>

      <Section title="General notes" hint={doc.notes.trim() ? String(doc.notes.split(/\r?\n/).filter((l) => l.trim()).length) : undefined}>
        <textarea
          aria-label="General notes"
          key={doc.notes}
          defaultValue={doc.notes}
          rows={7}
          maxLength={NOTES_LIMIT}
          placeholder={"All dimensions to be verified on site.\nRemove burrs after cutting."}
          onBlur={(e) => {
            const next = e.target.value.replace(/\s+$/, "");
            if (next === doc.notes) return;
            if (next.length > NOTES_LIMIT) {
              e.target.value = doc.notes;
              onError(`Notes are limited to ${NOTES_LIMIT} characters.`);
            } else if (!edit((d) => (d.notes = next))) e.target.value = doc.notes;
          }}
        />
        <p className="iso-help">One note per line. They print above the title block, numbered automatically.</p>
      </Section>
    </div>
  );
}
