import { useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { holdItemNumbers, setIssuedCell, sheetMaterials } from "../core/material-list";
import { clone, type IsoDocument } from "../core/model";
import { unitsPerMm } from "../core/paper";
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, validateSheetTemplate, type SheetTemplate } from "../core/sheet-template";
import { sheetTemplateOf } from "../core/iso/sheet";
import { download } from "./download";
import { Actions, Group, NumberInput, Note, Row, Section, Segmented, TextInput, Toggle } from "./inspector/kit";

type Commit = (edit: (d: IsoDocument) => void) => boolean | void;
const EMBEDDED = "embedded";

/** Reads a template JSON file; throws a message naming the first problem. */
export function readTemplateJson(text: string): SheetTemplate {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The template file is not JSON.");
  }
  return validateSheetTemplate(raw);
}
/** A built-in by id (the default is the absence of a choice), or a copy carried in the drawing. */
export function setSheetTemplate(d: IsoDocument, template: string | SheetTemplate) {
  d.sheetFormat = "production";
  if (typeof template === "string") {
    if (template === DEFAULT_TEMPLATE_ID) delete d.sheetTemplate;
    else d.sheetTemplate = template;
  } else d.sheetTemplate = clone(template);
}
export const templateFileName = (t: SheetTemplate) => `${t.name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "sheet-template"}.json`;

/** Sheet format and, for production sheets, the title-block template: built-in, or imported and carried in the drawing. */
export function SheetFormatSettings({ doc, commit }: { doc: IsoDocument; commit: Commit }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const production = doc.sheetFormat === "production";
  const template = sheetTemplateOf(doc), embedded = typeof doc.sheetTemplate === "object" && doc.sheetTemplate !== null;
  const chosen = embedded ? EMBEDDED : typeof doc.sheetTemplate === "string" ? doc.sheetTemplate : DEFAULT_TEMPLATE_ID;
  return (
    <>
      <Row label="Sheet format" group keywords="paper format classic production title block template">
        <Segmented aria="Sheet format" value={production ? "production" : "classic"}
          choices={[{ value: "classic", label: "Classic", title: "Spoolyard's own paper" }, { value: "production", label: "Title block", title: "A title-block template" }]}
          onChange={(v) => commit((d) => { d.sheetFormat = v; })} />
      </Row>
      {production && (
        <>
          <Row label="Template" keywords="title block template form">
            <select aria-label="Title block template" value={chosen} onChange={(e) => {
              if (e.target.value !== EMBEDDED) commit((d) => setSheetTemplate(d, e.target.value));
            }}>
              {Object.entries(BUILTIN_TEMPLATES).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
              {embedded && <option value={EMBEDDED}>{template.name} (in this drawing)</option>}
            </select>
          </Row>
          {template.description && <Note keywords="template">{template.description}</Note>}
          <Actions keywords="import export template json">
            <button type="button" onClick={() => input.current?.click()}>Import template…</button>
            <button type="button" onClick={() => download(templateFileName(template), JSON.stringify(template, null, 1) + "\n", "application/json")}>Export template</button>
          </Actions>
          <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Import title block template" onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              const imported = readTemplateJson(await file.text());
              commit((d) => setSheetTemplate(d, imported));
              setError("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not read the template.");
            }
          }} />
          {error && <Note tone="warn">{error}</Note>}
        </>
      )}
    </>
  );
}

/** The extra title-block fields the drawing's template declares; `onChange` stores one (empty clears it). */
export function TemplateFieldRows({ doc, onChange }: { doc: IsoDocument; onChange: (key: string, value: string) => void }) {
  if (doc.sheetFormat !== "production") return null;
  const fields = sheetTemplateOf(doc).fields ?? [];
  if (!fields.length) return null;
  return (
    <Group title="Template fields">
      {fields.map((f) => (
        <Row key={f.key} label={f.label} keywords={f.key}>
          <TextInput aria={f.label} value={doc.titleBlock?.custom?.[f.key] ?? ""} maxLength={200} onCommit={(v) => onChange(f.key, v.trim())} />
        </Row>
      ))}
    </Group>
  );
}
/** Sets one template field of a title block, removing it (and the list) when empty. */
export function setTemplateField(tb: NonNullable<IsoDocument["titleBlock"]>, key: string, value: string) {
  const custom = (tb.custom ??= {});
  if (value) custom[key] = value.slice(0, 200); else delete custom[key];
  if (!Object.keys(custom).length) delete tb.custom;
}

const round = (v: number) => Math.round(v * 100) / 100;
const COLUMN_LABELS = ["Item", "Quantity", "Size"] as const;

/** Material-table layout held for one sheet: its width, column widths, item numbers and issued cells. */
export function MaterialTableSection({ doc, spool, commit, onError }: { doc: IsoDocument; spool: string; commit: Commit; onError: (message: string) => void }) {
  const own = doc.sheets?.[spool] ?? {}, mm = unitsPerMm(doc.paper);
  const info = (d: IsoDocument) => ((d.sheets ??= {})[spool] ??= {});
  const rows = own.bomOrder ? sheetMaterials(doc, spool) : [];
  const held = [own.bomWidth != null, own.bomColumns != null, own.bomOrder != null].filter(Boolean).length;
  return (
    <Section id="sheet.material-table" title="Material table" summary={held ? `${held} held` : "Automatic"}>
      <Note>For sheet {spool || "Unassigned"}. Calculated quantities are unchanged; only the printed table is held.</Note>
      <Row label="Table width" keywords="material bom width paper" modified={own.bomWidth != null}
        onReset={() => commit((d) => { delete info(d).bomWidth; })}>
        <NumberInput aria={`Material table width in mm on paper for ${spool}`} suffix="mm" placeholder="Automatic"
          value={own.bomWidth == null ? undefined : round(own.bomWidth / mm)} min={round(250 / mm)} max={round(1000 / mm)} onError={onError}
          onCommit={(v) => {
            if (v == null) return commit((d) => { delete info(d).bomWidth; });
            const width = v * mm;
            if (own.bomColumns && own.bomColumns.reduce((a, b) => a + b, 0) > width - 40) return onError("Leave room for the description beside the held columns.");
            commit((d) => { info(d).bomWidth = width; });
          }} />
      </Row>
      <Toggle label="Hold column widths" keywords="material bom columns" checked={!!own.bomColumns}
        onChange={(on) => commit((d) => { if (on) info(d).bomColumns = [46, 69, 46]; else delete info(d).bomColumns; })} />
      {own.bomColumns && COLUMN_LABELS.map((label, i) => (
        <Row key={label} label={`${label} column`} keywords="material bom column width">
          <NumberInput aria={`${label} material column width for ${spool}`} suffix="mm" value={round(own.bomColumns![i] / mm)}
            min={round(12 / mm)} max={round(150 / mm)} onError={onError} onCommit={(v) => {
              if (v == null) return;
              const next = [...own.bomColumns!] as [number, number, number];
              next[i] = v * mm;
              if (next.reduce((a, b) => a + b, 0) > Math.min(300, (own.bomWidth ?? 1000) - 40)) return onError("Leave room for the description beside the held columns.");
              commit((d) => { info(d).bomColumns = next; });
            }} />
        </Row>
      ))}
      <Toggle label="Hold item numbers as issued" hint="New items are numbered after them" keywords="material bom order item numbers"
        checked={!!own.bomOrder} onChange={(on) => commit((d) => holdItemNumbers(d, spool, on))} />
      {rows.map((row, i) => {
        const cells = own.issuedValues?.[row.key];
        const move = (by: -1 | 1) => commit((d) => {
          const order = sheetMaterials(d, spool).map((r) => r.key);
          [order[i], order[i + by]] = [order[i + by], order[i]];
          info(d).bomOrder = order;
        });
        // Recorded with the value it replaced, so a later change to the model can be seen against what was issued.
        const setCell = (key: "qtyText" | "nd" | "description", value: string) => commit((d) => setIssuedCell(d, spool, row.key, key, value || undefined));
        return (
          <Group key={row.key} title={`Item ${row.id}${cells ? " · issued cells" : ""}`}>
            <Actions keywords="material bom order">
              <button type="button" aria-label={`Move item ${row.id} up`} disabled={!i} onClick={() => move(-1)}><ArrowUp size={12} /> Up</button>
              <button type="button" aria-label={`Move item ${row.id} down`} disabled={i === rows.length - 1} onClick={() => move(1)}><ArrowDown size={12} /> Down</button>
            </Actions>
            {([["qtyText", "Issued QTY"], ["nd", "Issued ND"], ["description", "Issued description"]] as const).map(([key, label]) => (
              <Row key={key} label={label} keywords="material bom issued verbatim" modified={cells?.[key] != null} onReset={() => setCell(key, "")}>
                <TextInput aria={`${label} for item ${row.id}`} value={cells?.[key] ?? ""} placeholder={row.calculated?.[key] ?? row[key]}
                  multiline={key === "description"} maxLength={key === "description" ? 2000 : 120} onCommit={(v) => setCell(key, v.trim())} />
              </Row>
            ))}
            <Row label="Row height" keywords="material bom row height" modified={own.bomRowHeights?.[row.key] != null}
              onReset={() => commit((d) => { delete info(d).bomRowHeights?.[row.key]; })}>
              <NumberInput aria={`Row height in mm on paper for item ${row.id}`} suffix="mm" placeholder="Automatic"
                value={own.bomRowHeights?.[row.key] == null ? undefined : round(own.bomRowHeights[row.key] / mm)} min={round(8 / mm)} max={round(200 / mm)}
                onError={onError} onCommit={(v) => commit((d) => {
                  const heights = (info(d).bomRowHeights ??= {});
                  if (v == null) delete heights[row.key]; else heights[row.key] = v * mm;
                })} />
            </Row>
          </Group>
        );
      })}
    </Section>
  );
}
