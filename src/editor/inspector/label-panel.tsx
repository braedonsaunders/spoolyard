import type { PaperLabel } from "../../core/drawing";
import { COMPONENT_TYPES } from "../../core/components";
import { sizeFor } from "../../core/format";
import { getNode, type IsoDocument } from "../../core/model";
import { paperUnits } from "../paper";
import { Actions, Note, NumberInput, PairHead, PaperPointInputs, Row, Section, TextInput } from "./kit";
import { OPERATORS } from "./node-panel";

const KINDS: Array<[RegExp, string]> = [
  [/^item-number:/, "Item number"],
  [/#operator\d*$/, "Operator line"],
  [/#tag\d*$/, "Tag line"],
  [/#size\d*$/, "Size line"],
  [/^item:/, "Item callout"],
  [/^joint:/, "Joint callout"],
  [/^stub:/, "Stub-end tag"],
  [/^drafted-dimension:/, "Dimension"],
  [/^pipe-tag:/, "Pipe item tag"],
  [/^line:/, "Line number"],
  [/^support:/, "Support label"],
  [/^tie:/, "Tie point"],
  [/^bubble:/, "Instrument bubble"],
  [/^equipment:/, "Equipment label"],
  [/^insulation-limit:/, "Insulation limit"],
  [/^insulation:/, "Insulation label"],
  [/^reference-line:/, "Adjacent line number"],
  [/^offset-angle:/, "Offset angle"],
  [/^offset-leg:/, "Offset leg value"],
  [/^continuation:/, "Continuation note"],
  [/^elevation:/, "Elevation"],
  [/^size:/, "Size label"],
];
/** What a paper label is, in the drafter's words. */
export function labelKind(label: PaperLabel) {
  return KINDS.find(([re]) => re.test(label.key))?.[1] ?? (label.dimension ? "Dimension" : "Label");
}
/** The pipe or component a label describes, by name. */
export function labelOwnerName(doc: IsoDocument, label: PaperLabel) {
  const node = doc.nodes.find((n) => n.id === label.owner), run = doc.runs.find((r) => r.id === label.owner);
  if (node) return [COMPONENT_TYPES.find((t) => t.code === node.component)?.label ?? node.kind, node.tag].filter(Boolean).join(" · ");
  if (run) return `${sizeFor(doc, run.nps)} pipe`;
  return undefined;
}

/**
 * The words a label prints, where the drafter types them: a valve's tag, a support's caption, a tie point, an open
 * end's continuation note, a line number. Labels whose text is worked out (item numbers, sizes, lengths) have none.
 */
export interface LabelText {
  value: string;
  multiline?: boolean;
  placeholder?: string;
  /** A fixed list to choose from instead of free text. */
  choices?: string[];
  set: (d: IsoDocument, value: string) => void;
}
export function labelText(doc: IsoDocument, label: PaperLabel): LabelText | undefined {
  const node = doc.nodes.find((n) => n.id === label.owner);
  if (node && /#tag\d*$/.test(label.key)) return { value: node.tag ?? "", placeholder: "e.g. HV-101", set: (d, v) => { getNode(d, node.id).tag = v.trim() || undefined; } };
  if (node && /#operator\d*$/.test(label.key)) return { value: node.operator ?? "", choices: OPERATORS, set: (d, v) => { getNode(d, node.id).operator = v || undefined; } };
  if (node && /^continuation:/.test(label.key) && node.continuation)
    return { value: node.continuation.text, multiline: true, set: (d, v) => { const n = getNode(d, node.id); n.continuation = v.trim() ? { ...n.continuation!, text: v } : undefined; } };
  if (node && /^tie:/.test(label.key) && node.tiePoint) return { value: node.tiePoint.id, set: (d, v) => { const n = getNode(d, node.id); n.tiePoint = v.trim() ? { ...n.tiePoint, id: v.trim() } : undefined; } };
  if (node && /^support:/.test(label.key)) return { value: node.calloutText ?? "", placeholder: COMPONENT_TYPES.find((t) => t.code === node.component)?.label.toUpperCase(), set: (d, v) => { getNode(d, node.id).calloutText = v.trim() || undefined; } };
  const line = /^line:([^:]*)/.exec(label.key)?.[1];
  if (line != null && line !== "") {
    // A line number names every pipe on the line in this sheet.
    return { value: line, set: (d, v) => { if (!v.trim()) throw new Error("Enter a line number."); for (const r of d.runs) if (r.line === line && (!label.spool || r.spool === label.spool)) r.line = v.trim(); } };
  }
  return undefined;
}

export interface LabelPanelProps {
  doc: IsoDocument;
  label: PaperLabel;
  commit: (edit: (d: IsoDocument) => void, options?: { key?: string }) => boolean;
  onError: (message: string) => void;
  reset: (bend: boolean) => void;
  resetLeader: () => void;
  resetDimension: () => void;
  selectOwner?: () => void;
  /** Labels on this sheet drawn clear of their held spot, because it overprints. */
  cleared: number;
  keepCleared: () => void;
  resetSheet: () => void;
}

/** One callout piece picked on the sheet: what it says, where it sits and how it is lettered, and the way back. */
/** The command that saves the spots labels were moved to automatically, worded the same in the panel and the menu. */
export const saveAutoMovedText = (count: number) => `Save ${count || ""}${count ? " " : ""}auto-moved label position${count === 1 ? "" : "s"}`;
export const SAVE_AUTO_MOVED_HINT =
  "Labels placed by hand where they now overprint other lettering are drawn at the nearest clear spot. This saves those spots as their positions, so they stay put.";

export function LabelPanel({ doc, label, commit, onError, reset, resetLeader, resetDimension, selectOwner, cleared, keepCleared, resetSheet }: LabelPanelProps) {
  const info = doc.sheets?.[label.spool], held = info?.labelPositions ?? {};
  const moved = !!held[label.key] || Object.keys(held).some((k) => k.startsWith(label.key + "#"));
  const paper = paperUnits(doc);
  const place = (key: string, point: [number, number]) => commit((d) => {
    const sheet = ((d.sheets ??= {})[label.spool] ??= {});
    sheet.labelPositions = { ...sheet.labelPositions, [key]: point };
  });
  const bend = label.leader?.bend;
  const sheetHeld = Object.keys(held).length;
  const text = labelText(doc, label);
  const ink = label.ink.find((p) => p.type === "text");
  const style = info?.labelStyles?.[label.key];
  const setStyle = (field: "size" | "rotation" | "oblique", value: number | undefined) => commit((d) => {
    const sheet = ((d.sheets ??= {})[label.spool] ??= {}), styles = (sheet.labelStyles ??= {}), own = (styles[label.key] ??= {});
    if (value == null) delete own[field];
    else own[field] = value;
    if (!Object.keys(own).length) delete styles[label.key];
  });
  return (
    <>
      {text && (
        <Section id="label.text" title="Text" defaultOpen>
          <Row label="Label text" keywords="text tag words" stack={text.multiline}>
            {text.choices ? (
              <select aria-label="Label text" value={text.value} onChange={(e) => commit((d) => text.set(d, e.target.value))}>
                <option value="">Not shown</option>
                {text.choices.map((c) => <option key={c}>{c}</option>)}
                {text.value && !text.choices.includes(text.value) && <option>{text.value}</option>}
              </select>
            ) : (
              <TextInput aria="Label text" value={text.value} multiline={text.multiline} placeholder={text.placeholder} maxLength={2000} onError={onError}
                onCommit={(v) => commit((d) => text.set(d, v))} />
            )}
          </Row>
          {label.owner && <Note>The text belongs to the {labelOwnerName(doc, label) ?? "item"} it describes, so every sheet and list that shows it changes with it.</Note>}
        </Section>
      )}
      {ink?.type === "text" && (
        <Section id="label.lettering" title="Lettering" summary={style ? "Adjusted" : "Automatic"}>
          {([["size", "Letter height", 0.1, 100, ink.size], ["rotation", "Label rotation", -360, 360, ink.rotation ?? 0], ["oblique", "Label oblique angle", -85, 85, ink.oblique ?? 0]] as const).map(([field, name, min, max, auto]) => (
            <Row key={field} label={name} keywords="lettering text size angle" modified={style?.[field] != null} onReset={() => setStyle(field, undefined)}>
              {field === "size"
                ? <NumberInput aria={name} value={style?.size == null ? undefined : paper.length(style.size)} placeholder={paper.text(paper.length(auto))} suffix={paper.unit}
                    decimals={paper.decimals} min={Number(paper.text(paper.length(min)))} max={Number(paper.text(paper.length(max)))} onError={onError}
                    onCommit={(v) => setStyle("size", v == null ? undefined : paper.sheet(v))} />
                : <NumberInput aria={name} value={style?.[field]} placeholder={String(Math.round(auto * 10) / 10)} suffix="°" min={min} max={max} onError={onError}
                    onCommit={(v) => setStyle(field, v)} />}
            </Row>
          ))}
          <Note>Blank fields use the sheet's automatic lettering for this label.</Note>
        </Section>
      )}
      <Section id="label.placement" title="Placement" defaultOpen summary={moved ? "Moved" : "Automatic"}>
        {label.overlapping && <Note tone="warn" keywords="overprint overlap">This moved label overprints other lettering or linework and no clear spot was found nearby. Drag it somewhere clear.</Note>}
        {label.displaced && !label.overlapping && <Note keywords="displaced moved clear">Its saved spot overprints other lettering, so it is drawn at the nearest clear spot. Save the auto-moved positions to keep it there.</Note>}
        <Row label="Position" keywords="placement held automatic">
          <span className="insp-value">{moved ? "Moved by hand" : "Automatic · kept clear"}</span>
        </Row>
        <PairHead columns={[`X · ${paper.unit}`, `Y · ${paper.unit}`]} />
        <Row label="On the sheet" keywords="position paper x y" hint="From the sheet's lower-left corner" pair>
          <PaperPointInputs point={label.at} paper={paper} aria="Label position" onError={onError} onCommit={(p) => place(label.key, p)} />
        </Row>
        {label.parent && <Note>Drawn as part of its callout. Drag it, or Ctrl/⌘-click it on the sheet, to place it on its own.</Note>}
        <Actions keywords="reset position automatic">
          <button type="button" disabled={!moved} onClick={() => reset(false)}>Reset label position</button>
          {selectOwner && <button type="button" title={labelOwnerName(doc, label)} onClick={selectOwner}>Select {doc.runs.some((r) => r.id === label.owner) ? "pipe" : "component"}</button>}
        </Actions>
      </Section>
      {label.leader && (
        <Section id="label.leader" title="Leader" defaultOpen summary={label.leader.held ? "Bend moved" : "Automatic"}>
          {bend && (
            <Row label="Bend on the sheet" keywords="leader bend" pair>
              <PaperPointInputs point={bend} paper={paper} aria="Leader bend" onError={onError} onCommit={(p) => place(`leader:${label.key}`, p)} />
            </Row>
          )}
          <Note>Drag the square handle on the leader to bend it.</Note>
          <Actions keywords="leader bend reset">
            <button type="button" disabled={!label.leader.held} onClick={resetLeader}>Reset leader bend</button>
          </Actions>
        </Section>
      )}
      {label.dimension && (
        <Section id="label.dimension" title="Dimension line" defaultOpen>
          <Note>Right-click the dimension and choose Move dimension line (or Shift-drag its text).</Note>
          <Actions keywords="dimension layout reset">
            <button type="button" onClick={resetDimension}>Reset dimension layout</button>
          </Actions>
        </Section>
      )}
      <Section id="label.sheet" title="All labels on this sheet" summary={cleared ? `${cleared} auto-moved` : `${sheetHeld} moved`}>
        <Actions keywords="sheet labels save keep cleared auto moved overprint reset all">
          <button type="button" className={cleared ? "is-primary" : undefined} disabled={!cleared} onClick={keepCleared} title={SAVE_AUTO_MOVED_HINT}>
            {saveAutoMovedText(cleared)}
          </button>
          <button type="button" disabled={!sheetHeld} onClick={resetSheet}>Reset all label positions</button>
        </Actions>
      </Section>
      <Note>Drag to move · double-click to edit · arrow keys nudge (Shift for more) · Del resets the position · Esc deselects.</Note>
    </>
  );
}
