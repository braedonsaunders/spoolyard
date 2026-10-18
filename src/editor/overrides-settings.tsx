import { Plus, Trash2 } from "lucide-react";
import { COMPONENT_TYPES } from "../core/components";
import { directionName } from "../core/component-position";
import { sizeFor } from "../core/format";
import { dimensionTier } from "../core/iso/context";
import { getNode, styleOf, sub, type IsoDocument, type PipeNode, type SheetDimension, type Vec3 } from "../core/model";
import { KIND_LABELS } from "./choices";
import { DIRECTIONS } from "./command-line";
import { paperUnits } from "./paper";
import { Actions, Group, Note, PaperInput, Row, Section, Toggle } from "./inspector/kit";

type Commit = (edit: (d: IsoDocument) => void) => boolean | void;

/** How many things a drawing holds against its automatic layout: shown as a badge wherever overrides are listed. */
export function overrideCount(doc: IsoDocument): number {
  let n = styleOf(doc).dimensionRounding === "individual" ? 1 : 0;
  for (const info of Object.values(doc.sheets ?? {})) {
    if (info.dimensions) n++;
    n += Object.keys(info.labelStyles ?? {}).length;
    n += [info.bomWidth != null, info.bomColumns != null, info.bomOrder != null].filter(Boolean).length;
    n += Object.keys(info.issuedValues ?? {}).length + Object.keys(info.bomRowHeights ?? {}).length;
  }
  return n;
}

/** A connection by what the drafter calls it: its tag, or its type and number on the sheet. */
export function nodeName(nodes: PipeNode[], node: PipeNode) {
  const type = COMPONENT_TYPES.find((t) => t.code === node.component)?.label ?? KIND_LABELS[node.kind] ?? node.kind;
  if (node.tag) return `${node.tag} (${type.toLowerCase()})`;
  const same = nodes.filter((n) => (COMPONENT_TYPES.find((t) => t.code === n.component)?.label ?? KIND_LABELS[n.kind] ?? n.kind) === type);
  return same.length > 1 ? `${type} ${same.indexOf(node) + 1}` : type;
}

/**
 * Overrides: settings that hold an issued sheet as it was printed, against the automatic layout. They are for
 * matching drawings issued before (legacy rounding, drafted dimension sets, adjusted label lettering); a badge says
 * how many are active, so a drawing that carries them is never mistaken for an automatic one.
 */
export function OverridesSection({ doc, spools, spool, commit, onError }: {
  doc: IsoDocument; spools: string[]; spool: string; commit: Commit; onError: (message: string) => void;
}) {
  const count = overrideCount(doc), style = styleOf(doc), paper = paperUnits(doc);
  return (
    <Section id="sheet.overrides" title="Overrides (advanced)" summary={count ? `${count} active` : "None"}>
      <Note keywords="override issued legacy">For matching sheets issued before. Each override holds something the sheet would otherwise lay out itself. The material table's held widths and issued cells are under Material table.</Note>
      <Toggle label="Round each dimension on its own" hint="Older issued drawings: a chain's rounded dimensions may not add up to its overall"
        checked={style.dimensionRounding === "individual"} onChange={(on) => commit((d) => { d.style = { ...styleOf(d), dimensionRounding: on ? "individual" : "chain" }; })} />
      {spools.map((s) => {
        const info = doc.sheets?.[s] ?? {}, styled = Object.keys(info.labelStyles ?? {}).length;
        const runs = doc.runs.filter((r) => r.spool === s), ends = new Set(runs.flatMap((r) => [r.from, r.to]));
        const nodes = doc.nodes.filter((n) => ends.has(n.id) || (n.associatedRunId && runs.some((r) => r.id === n.associatedRunId)));
        const change = (i: number, fn: (dim: SheetDimension) => void) => commit((d) => fn(d.sheets![s].dimensions![i]));
        const face = (runId: string, nodeId: string) => {
          const r = doc.runs.find((x) => x.id === runId)!, far = r.from === nodeId ? r.to : r.from;
          return `${sizeFor(doc, r.nps)} pipe going ${directionName(sub(getNode(doc, far).position, getNode(doc, nodeId).position))}`;
        };
        return (
          <Group key={s} title={`Sheet ${s || "Unassigned"}${s === spool ? " · shown" : ""}`}>
            {styled > 0 && (
              <Row label="Label lettering" keywords="label lettering size rotation">
                <span className="insp-value">{styled} adjusted</span>
                <button type="button" className="insp-reset" aria-label={`Reset label lettering on ${s}`} title="Reset every label's lettering on this sheet"
                  onClick={() => commit((d) => { delete d.sheets?.[s]?.labelStyles; })}><Trash2 size={11} /></button>
              </Row>
            )}
            <Toggle label="Drafted dimensions" aria={`Drafted dimensions on ${s}`} hint="A drafted set replaces the automatic dimensions; lengths still follow the model"
              checked={info.dimensions != null} onChange={(on) => commit((d) => { const own = ((d.sheets ??= {})[s] ??= {}); if (on) own.dimensions = []; else delete own.dimensions; })} />
            {info.dimensions && (
              <>
                <Row label="Replaces" keywords="drafted dimension scope">
                  <select aria-label={`Drafted dimension scope on ${s}`} value={info.dimensionScope ?? "sheet"} onChange={(e) => commit((d) => { d.sheets![s].dimensionScope = e.target.value as "sheet" | "legs"; })}>
                    <option value="sheet">Every automatic dimension</option>
                    <option value="legs">Measured straights only</option>
                  </select>
                </Row>
                {info.dimensions.map((dim, i) => (
                  <Group key={i} title={`Dimension ${i + 1}`}>
                    {(["from", "to"] as const).map((end) => (
                      <div key={end}>
                        <Row label={end === "from" ? "From" : "To"} keywords="drafted dimension point">
                          <select aria-label={`Dimension ${i + 1} ${end} point`} value={dim[end].nodeId} onChange={(e) => change(i, (v) => { v[end] = { nodeId: e.target.value }; })}>
                            {nodes.map((n) => <option key={n.id} value={n.id}>{nodeName(nodes, n)}</option>)}
                          </select>
                        </Row>
                        <Row label="Measured to" keywords="drafted dimension face work point">
                          <select aria-label={`Dimension ${i + 1} ${end} measured to`} value={dim[end].adjacent ? `adjacent:${dim[end].adjacent}` : dim[end].face ? `${dim[end].face}:${dim[end].runId}` : "work"}
                            onChange={(e) => change(i, (v) => {
                              const value = e.target.value, nodeId = v[end].nodeId;
                              if (value === "work") v[end] = { nodeId };
                              else if (value.startsWith("adjacent:")) v[end] = { nodeId, adjacent: value.slice("adjacent:".length) };
                              else { const split = value.indexOf(":"); v[end] = { nodeId, face: value.slice(0, split) as "body" | "mate", runId: value.slice(split + 1) }; }
                            })}>
                            <option value="work">Work point</option>
                            {(doc.references ?? []).filter((r) => r.atNodeId === dim[end].nodeId && r.dimensionTo).map((r) => <option key={r.id} value={`adjacent:${r.id}`}>Adjacent work point · {r.name}</option>)}
                            {doc.runs.filter((r) => [r.from, r.to].includes(dim[end].nodeId)).flatMap((r) => (["body", "mate"] as const).map((f) => (
                              <option key={`${f}:${r.id}`} value={`${f}:${r.id}`}>{f === "body" ? "Body face" : "Mating face"} toward the {face(r.id, dim[end].nodeId)}</option>
                            )))}
                          </select>
                        </Row>
                      </div>
                    ))}
                    <Row label="Extension direction" keywords="drafted dimension axis">
                      <select aria-label={`Dimension ${i + 1} direction`} value={dim.axis.join(",")} onChange={(e) => change(i, (v) => { v.axis = e.target.value.split(",").map(Number) as Vec3; })}>
                        {DIRECTIONS.map((d) => <option key={d.name} value={d.vector.join(",")}>{d.name}</option>)}
                      </select>
                    </Row>
                    <Row label="Offset on paper" keywords="drafted dimension offset">
                      <PaperInput aria={`Dimension ${i + 1} paper offset`} sheet={dim.offset} paper={paper} min={-5000} max={5000} onError={onError} onCommit={(v) => v != null && change(i, (x) => { x.offset = v; })} />
                    </Row>
                    <Row label="Length format" keywords="drafted dimension format feet inches">
                      <select aria-label={`Dimension ${i + 1} length format`} value={dim.format ?? ""} onChange={(e) => change(i, (v) => { v.format = (e.target.value || undefined) as SheetDimension["format"]; })}>
                        <option value="">Automatic</option>
                        <option value="feet">Feet and inches</option>
                        <option value="feet-short">Feet, omit zero inches</option>
                        <option value="inches">Inches</option>
                      </select>
                    </Row>
                    <Toggle label="Flip lettering" aria={`Flip dimension ${i + 1} lettering`} checked={!!dim.reverseText} onChange={(on) => change(i, (v) => { v.reverseText = on || undefined; })} />
                    <Actions><button type="button" onClick={() => commit((d) => { d.sheets![s].dimensions!.splice(i, 1); })}><Trash2 size={12} /> Remove dimension {i + 1}</button></Actions>
                  </Group>
                ))}
                <Actions>
                  <button type="button" disabled={!runs.length} onClick={() => commit((d) => {
                    const run = d.runs.find((r) => r.spool === s);
                    if (!run) return;
                    const from = getNode(d, run.from).position, to = getNode(d, run.to).position;
                    const vertical = Math.abs(to[2] - from[2]) > Math.hypot(to[0] - from[0], to[1] - from[1]);
                    // A new dimension is put at the sheet's first dimension tier, square to its pipe.
                    d.sheets![s].dimensions!.push({ from: { nodeId: run.from }, to: { nodeId: run.to }, axis: vertical ? [1, 0, 0] : [0, 0, 1], offset: dimensionTier(d) });
                  })}><Plus size={12} /> Add dimension</button>
                </Actions>
              </>
            )}
          </Group>
        );
      })}
    </Section>
  );
}
