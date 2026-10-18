import type { Point } from "../../core/drawing";
import { draftingSizes } from "../../core/iso/context";
import { LINE_SPACING, measureText } from "../../core/stroke-font";
import type { IsoDocument, SheetNote } from "../../core/model";
import { paperUnits } from "../paper";
import { parsePath, pathText } from "./node-panel";
import { Actions, ColorInput, Note, NumberInput, PairHead, PaperInput, PaperPointInputs, Row, Section, Segmented, TextInput, Toggle } from "./kit";

const DEFAULT_INK = "#111111";
/** Room around a callout's lettering inside its box, and its leader's reach, in text heights. */
const BOX_PAD = 0.6, LEADER_REACH = 6, LEADER_SHOULDER = 1.5;

/** The box that fits a callout's lettering, a little clear of it. */
export function noteBox(note: Pick<SheetNote, "at" | "text" | "size">, text: number): NonNullable<SheetNote["box"]> {
  const size = note.size ?? text, rows = note.text.split("\n").length, pad = size * BOX_PAD;
  const width = measureText(note.text.toUpperCase(), size) + 2 * pad, height = size * (1 + (rows - 1) * LINE_SPACING) + 2 * pad;
  return { at: [note.at[0] - pad, note.at[1] - size - pad], width, height };
}
/** A leader from the callout's lettering out to the upper left, to be dragged onto what it points at. */
export function noteLeader(note: Pick<SheetNote, "at" | "size">, text: number): Array<[number, number]> {
  const size = note.size ?? text, [x, y] = note.at;
  return [[x - size * LEADER_REACH, y - size * LEADER_REACH], [x - size * LEADER_SHOULDER, y - size / 2], [x - size / 2, y - size / 2]];
}

/** A free callout on a sheet: its words, where it sits, its lettering, and its box and leader. */
export function NotePanel({ doc, note, commit, onError }: {
  doc: IsoDocument; note: SheetNote; commit: (edit: (d: IsoDocument) => void, options?: { key?: string }) => boolean; onError: (message: string) => void;
}) {
  const paper = paperUnits(doc);
  const edit = (change: (n: SheetNote) => void, key?: string) =>
    commit((d) => { const n = d.sheetNotes?.find((x) => x.id === note.id); if (n) change(n); }, key ? { key: `${note.id}:${key}` } : undefined);
  const lettering = draftingSizes(doc).text, size = note.size ?? lettering;
  return (
    <>
      <Section id="note.text" title="Callout" defaultOpen summary={note.spool || "Every sheet"}>
        <Row label="Text" keywords="callout words" stack>
          <TextInput aria="Callout text" value={note.text} multiline maxLength={2000} onError={onError}
            onCommit={(v) => { if (!v.trim()) { onError("A callout needs text; erase it to remove it."); return false; } edit((n) => { n.text = v; }); }} />
        </Row>
        <PairHead columns={[`X · ${paper.unit}`, `Y · ${paper.unit}`]} />
        <Row label="On the sheet" keywords="position x y" hint="The lettering's start, from the sheet's lower-left corner. Or drag the callout on the sheet." pair>
          <PaperPointInputs point={note.at} paper={paper} aria="Callout position" onError={onError} onCommit={(p) => edit((n) => {
            const dx = p[0] - n.at[0], dy = p[1] - n.at[1];
            n.at = p;
            // The box moves with its lettering; the leader keeps pointing where it points.
            if (n.box) n.box = { ...n.box, at: [n.box.at[0] + dx, n.box.at[1] + dy] };
          })} />
        </Row>
      </Section>
      <Section id="note.lettering" title="Lettering" defaultOpen>
        <Row label="Lettering" keywords="font cad sans" group>
          <Segmented aria="Callout lettering" value={note.lettering ?? "cad"} onChange={(v) => edit((n) => { n.lettering = v; })}
            choices={[{ value: "cad", label: "CAD (ROMANS)" }, { value: "sans", label: "Sans" }]} />
        </Row>
        <Row label="Letter height" keywords="text size">
          <PaperInput aria="Callout text height" sheet={size} paper={paper} min={0.1} max={200} onError={onError} onCommit={(v) => edit((n) => { n.size = v; })} />
        </Row>
        <Row label="Rotation" keywords="angle">
          <NumberInput aria="Callout rotation" value={note.rotation} placeholder="0" suffix="°" min={-360} max={360} onError={onError} onCommit={(v) => edit((n) => { n.rotation = v || undefined; })} />
        </Row>
        <Row label="Oblique" keywords="slant angle">
          <NumberInput aria="Callout oblique angle" value={note.oblique} placeholder="0" suffix="°" min={-85} max={85} onError={onError} onCommit={(v) => edit((n) => { n.oblique = v || undefined; })} />
        </Row>
        <Row label="Text colour" keywords="ink colour color">
          <ColorInput aria="Callout text colour" value={note.textColor ?? DEFAULT_INK} onCommit={(v) => edit((n) => { n.textColor = v; }, "text-colour")} />
        </Row>
        <Row label="Line colour" keywords="box leader ink colour color">
          <ColorInput aria="Callout colour" value={note.color ?? DEFAULT_INK} onCommit={(v) => edit((n) => { n.color = v; }, "colour")} />
        </Row>
      </Section>
      <Section id="note.box" title="Box and leader" defaultOpen summary={[note.box && "box", note.leader && "leader"].filter(Boolean).join(" · ") || "None"}>
        <Toggle label="Box" aria="Callout box" checked={!!note.box} onChange={(on) => edit((n) => { n.box = on ? noteBox(n, lettering) : undefined; })} />
        {note.box && (
          <>
            <Row label="Box width" keywords="box size">
              <PaperInput aria="Callout box width" sheet={note.box.width} paper={paper} min={0.1} max={2000} onError={onError} onCommit={(v) => edit((n) => { n.box = { ...n.box!, width: v! }; })} />
            </Row>
            <Row label="Box height" keywords="box size">
              <PaperInput aria="Callout box height" sheet={note.box.height} paper={paper} min={0.1} max={2000} onError={onError} onCommit={(v) => edit((n) => { n.box = { ...n.box!, height: v! }; })} />
            </Row>
            <Actions keywords="box fit"><button type="button" onClick={() => edit((n) => { n.box = noteBox(n, lettering); })}>Fit box to text</button></Actions>
          </>
        )}
        <Toggle label="Leader" aria="Callout leader" checked={!!note.leader} onChange={(on) => edit((n) => { n.leader = on ? noteLeader(n, lettering) : undefined; n.arrow = on || undefined; })} />
        {note.leader && (
          <>
            <Toggle label="Arrowhead" aria="Callout leader arrowhead" checked={!!note.arrow} onChange={(on) => edit((n) => { n.arrow = on || undefined; })} />
            <Note keywords="leader grips">Drag the leader's grips on the sheet; drag a midpoint grip to add a bend.</Note>
            <Row label="Leader points" keywords="leader path" hint={`From the arrow end, on the sheet from its lower-left corner, ${paper.unit}: x, y; x, y`}>
              <TextInput aria="Callout leader points" value={pathText(note.leader as Point[], paper)} onError={onError}
                onCommit={(raw) => { const p = parsePath(raw, paper); if (!p) { onError("Enter at least two x, y points separated by semicolons."); return false; } edit((n) => { n.leader = p; }); }} />
            </Row>
          </>
        )}
      </Section>
    </>
  );
}
