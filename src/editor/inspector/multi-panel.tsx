import { COMPONENT_TYPES } from "../../core/components";
import { sizeFor, sizeHeader } from "../../core/format";
import { getSpec, prepAt, type EndPrep, type IsoDocument, type PipeNode, type PipeRun } from "../../core/model";
import { END_PREPS, KIND_LABELS } from "../choices";
import { routingSizes, type LibrarySpecSummary } from "../library";
import { Actions, Note, Row, Section, Segmented, TextInput, tri, untri } from "./kit";
import { fitOletToBranch } from "../edit-ops";
import { setRunSpec } from "../../core/component-position";

/** The one value every item shares, or undefined when they differ. */
function shared<T>(values: T[]): T | undefined {
  return values.length && values.every((v) => v === values[0]) ? values[0] : undefined;
}
const VARIES = "__varies__";

/**
 * Several pipes and components selected: what they share, edited for all of them at once. A property that differs
 * shows "Varies" until it is set; setting it applies to every selected item it belongs to. One undo step per change.
 */
export function MultiPanel({ doc, ids, commit, onError, library, libraryError, specBusy, onSelect }: {
  doc: IsoDocument; ids: string[]; commit: (edit: (d: IsoDocument) => void) => boolean; onError: (message: string) => void;
  library: LibrarySpecSummary[] | null; libraryError?: string; specBusy: string; onSelect: (ids: string[]) => void;
}) {
  const runs = doc.runs.filter((r) => ids.includes(r.id)), nodes = doc.nodes.filter((n) => ids.includes(n.id));
  const pipes = runs.filter((r) => !r.connector);
  const editRuns = (change: (r: PipeRun, d: IsoDocument) => void) => commit((d) => { for (const r of d.runs) if (ids.includes(r.id)) change(r, d); });
  const editNodes = (change: (n: PipeNode) => void) => commit((d) => { for (const n of d.nodes) if (ids.includes(n.id)) change(n); });
  const spec = shared(runs.map((r) => r.specId)), nps = shared(runs.map((r) => r.nps));
  // Sizes every selected pipe's specification offers.
  const sizesOf = (r: PipeRun) => routingSizes(doc, getSpec(doc, r.specId)).sizes;
  const sizes = runs.length ? sizesOf(runs[0]).filter((v) => runs.every((r) => sizesOf(r).includes(v))) : [];
  const preps = runs.flatMap((r) => [prepAt(r, 0), prepAt(r, 1)]), prep = shared(preps);
  const name = (key: string) => {
    const run = doc.runs.find((r) => r.id === key);
    if (run) return `${sizeFor(doc, run.nps)} pipe · ${run.spool}`;
    const node = doc.nodes.find((n) => n.id === key);
    return node ? [COMPONENT_TYPES.find((t) => t.code === node.component)?.label ?? KIND_LABELS[node.kind] ?? node.kind, node.tag].filter(Boolean).join(" · ") : key;
  };
  const extra = (library ?? []).filter((l) => !doc.specs.some((s) => s.id === l.id));
  return (
    <>
      {runs.length > 0 && (
        <Section id="multi.pipes" title={`${runs.length} pipe${runs.length === 1 ? "" : "s"}`} defaultOpen>
          <Row label="Specification" keywords="spec">
            <select aria-label="Specification of the selected pipes" value={spec ?? VARIES} disabled={!!specBusy}
              onChange={(e) => {
                const value = e.target.value;
                if (value === VARIES) return;
                if (value.startsWith("library:")) return onError("Add the library specification from one pipe's properties first, then apply it to the selection.");
                editRuns((r, d) => {
                  const chosen = getSpec(d, value);
                  if (!chosen.sizes.some((s) => s.nps === r.nps)) throw new Error(`Specification ${chosen.name} has no ${sizeFor(d, r.nps)} size for every selected pipe.`);
                  setRunSpec(d, r.id, value);
                });
              }}>
              {spec == null && <option value={VARIES}>Varies</option>}
              {doc.specs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {extra.length > 0 && <optgroup label="Standard library (add from one pipe first)">{extra.map((l) => <option key={l.slug} value={"library:" + l.slug} disabled>{l.id}</option>)}</optgroup>}
            </select>
            {libraryError && <span className="insp-hint">{libraryError}</span>}
          </Row>
          <Row label={sizeHeader(doc)} keywords="nps dn size">
            <select aria-label="Size of the selected pipes" value={nps ?? VARIES} onChange={(e) => e.target.value !== VARIES && editRuns((r, d) => { r.nps = Number(e.target.value); fitOletToBranch(d, r.from); fitOletToBranch(d, r.to); })}>
              {nps == null && <option value={VARIES}>Varies</option>}
              {sizes.map((v) => <option key={v} value={v}>{sizeFor(doc, v)}</option>)}
            </select>
          </Row>
          {(["spool", "line"] as const).map((k) => (
            <Row key={k} label={k === "spool" ? "Spool" : "Line number"} keywords={k}>
              <TextInput aria={`${k === "spool" ? "Spool" : "Line number"} of the selected pipes`} value={shared(runs.map((r) => r[k])) ?? ""} trim maxLength={120}
                placeholder={shared(runs.map((r) => r[k])) == null ? "Varies" : undefined}
                onCommit={(v) => { if (k === "spool" && !v) { onError("Enter a spool."); return false; } editRuns((r) => { r[k] = v; }); }} />
            </Row>
          ))}
          <Row label="End preparations" keywords="prep weld ends">
            <select aria-label="End preparation of the selected pipes" value={prep ?? VARIES}
              onChange={(e) => e.target.value !== VARIES && editRuns((r) => { r.fromPrep = r.toPrep = e.target.value as EndPrep; })}>
              {prep == null && <option value={VARIES}>Varies</option>}
              {END_PREPS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Row>
          {pipes.length > 0 && (
            <>
              <Row label="Size label" keywords="size label visibility" group>
                <Segmented aria="Size label of the selected pipes" value={shared(pipes.map((r) => tri(r.showSize))) ?? ("varies" as never)}
                  onChange={(v) => editRuns((r) => { if (!r.connector) r.showSize = untri(v); })}
                  choices={[{ value: "", label: "Auto" }, { value: "true", label: "Show" }, { value: "false", label: "Hide" }]} />
              </Row>
              <Row label="Line number label" keywords="line number visibility" group>
                <Segmented aria="Line number label of the selected pipes" value={shared(pipes.map((r) => tri(r.showLineNumber))) ?? ("varies" as never)}
                  onChange={(v) => editRuns((r) => { if (!r.connector) r.showLineNumber = untri(v); })}
                  choices={[{ value: "", label: "Auto" }, { value: "true", label: "Here" }, { value: "false", label: "Hide" }]} />
              </Row>
            </>
          )}
        </Section>
      )}
      {nodes.length > 0 && (
        <Section id="multi.nodes" title={`${nodes.length} component${nodes.length === 1 ? "" : "s"}`} defaultOpen>
          <Row label="Size label" keywords="size label visibility" group>
            <Segmented aria="Size label of the selected components" value={shared(nodes.map((n) => tri(n.showSize))) ?? ("varies" as never)}
              onChange={(v) => editNodes((n) => { n.showSize = untri(v); })}
              choices={[{ value: "", label: "Auto" }, { value: "true", label: "Show" }, { value: "false", label: "Hide" }]} />
          </Row>
          <Row label="Elevation (℄ EL)" keywords="elevation callout visibility" group>
            <Segmented aria="Elevation callout of the selected components"
              value={shared(nodes.map((n) => (n.elevationCallout == null ? "auto" : n.elevationCallout ? "show" : "hide"))) ?? ("varies" as never)}
              onChange={(v) => editNodes((n) => { n.elevationCallout = v === "auto" ? undefined : v === "show"; })}
              choices={[{ value: "auto", label: "Auto" }, { value: "show", label: "Show" }, { value: "hide", label: "Hide" }]} />
          </Row>
        </Section>
      )}
      <Section id="multi.list" title="Selected" summary={String(ids.length)}>
        <Note>Click one to edit it on its own. Shift- or Ctrl/⌘-click on the sheet adds or removes objects.</Note>
        <Actions>
          {ids.map((key) => <button type="button" key={key} onClick={() => onSelect([key])}>{name(key)}</button>)}
        </Actions>
      </Section>
    </>
  );
}
