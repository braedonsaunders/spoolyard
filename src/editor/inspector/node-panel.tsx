import { useRef, useState, type ReactNode } from "react";
import { COMPONENT_TYPE_BY_CODE, COMPONENT_TYPES, KIND_SYMBOL, SYMBOL_FAMILIES, type SymbolFamily } from "../../core/components";
import { symbolOf } from "../../core/iso/valve-conventions";
import { drawingReference } from "../../core/references";
import { flangedJoints, isLapJoint, nodeCode, nodeItem } from "../../core/joints";
import { boltSizeText, draftLength, sizeFor } from "../../core/format";
import { sheetMaterials } from "../../core/material-list";
import { directionName, moveComponentAlongPipe, placeAtTurn, type ComponentTrack } from "../../core/component-position";
import {
  applyComponent,
  connected,
  dimensionSource,
  setFlatSide,
  formatAllowance,
  formatLength,
  getNode,
  getSpec,
  parseIsoJson,
  pruneSheetAnchors,
  round,
  sub,
  type FlatSide,
  type IsoDocument,
  type PipeNode,
  type PipeRun,
} from "../../core/model";
import type { Point } from "../../core/drawing";
import { rowComponent } from "../spec-manager";
import { KIND_LABELS } from "../choices";
import { parseBendRadius, toOpenEnd } from "../edit-ops";
import { pipeOd } from "../../core/standards";
import { paperUnits, type PaperUnits } from "../paper";
import { Actions, Group, LengthInput, Metric, Metrics, Note, NumberInput, PairHead, PaperPointInputs, Row, Section, Segmented, Tabbed, TextInput, Toggle, tri, untri } from "./kit";

/** Eccentric reducers and swages, whose flat side is set as fabricated. */
export const ECCENTRIC = /^E-(RED|SWAGE|SWG)$/;
const TEMPLATES = ["CONT'D ON\nDWG# ", "CONT'D FROM\nDWG# ", "CONNECT TO ", "CLOSED"];
export const OPERATORS = ["OPERATOR UP", "OPERATOR DOWN", "OPERATOR NORTH", "OPERATOR SOUTH", "OPERATOR EAST", "OPERATOR WEST"];
/** Kinds whose own length is not part of a pipe cut. */
const NO_TAKEOUT = ["end", "weld", "support", "annotation"];
/** A paper route typed as "x, y; x, y" in paper units from the sheet's lower-left corner: the fallback to its grips. */
export const pathText = (path: Point[] | undefined, paper: PaperUnits) =>
  path?.map((p) => paper.point(p).map((v) => paper.text(v)).join(", ")).join("; ");
export const parsePath = (raw: string, paper: PaperUnits, max = 500): Array<[number, number]> | undefined | null => {
  const p = raw.trim() ? raw.split(";").map((row) => row.split(",").map(Number)) : undefined;
  if (!p) return undefined;
  if (p.length < 2 || p.length > max || p.some((q) => q.length !== 2 || !q.every(Number.isFinite))) return null;
  return p.map((q) => paper.fromPoint(q as Point).map((v) => Math.round(v * 100) / 100) as [number, number]);
};
/** Where a component's dimension comes from, as the drafter checks it. */
const SOURCE = { measured: "measured", specification: "specification", standard: "standard", missing: "missing" } as const;
const SOURCE_HINT = {
  measured: "Centre to pipe end, measured on this component. Empty uses the specification.",
  specification: "Centre to pipe end, from the specification's row for this component.",
  standard: "Centre to pipe end, from the ASME standard dimension: the specification gives none. Confirm it, or enter the measured takeout.",
  missing: "No known dimension: enter the centre-to-pipe-end distance so the pipe cuts can be calculated.",
} as const;
const KG_PER_LB = 0.45359237, M2_PER_FT2 = 0.09290304;
/** A symbol family as the drafter names it: "plug-valve" reads "Plug valve". */
const familyName = (f: string) => f[0].toUpperCase() + f.slice(1).replace(/-/g, " ");
/** The type choice that puts a pipe end back to an open end. */
const OPEN_END = "__open-end__";
/** Kinds whose branch has a takeout of its own. */
const BRANCHED = (kind: string, code: string) => kind === "tee" || kind === "olet" || /LAT$/.test(code);

export interface NodePanelProps {
  doc: IsoDocument;
  node: PipeNode;
  commit: (edit: (d: IsoDocument) => void) => boolean;
  onError: (message: string) => void;
  track: ComponentTrack | null;
  faces: [number, number] | null;
  turn: boolean;
  /** The largest pipe at the component, whose specification and size its catalogue rows follow. */
  header?: PipeRun;
  /** Specification and size used when the component has no pipe yet. */
  fallback: { specId: string; nps: number };
  missingTakeout: boolean;
  /** Where the component sits on the paper sheet, when the sheet is showing. */
  sheetPoint?: Point;
  extra?: ReactNode;
}

/** A component: what it is and where it sits, how it is made up and estimated, then its callouts on the sheet. */
export function NodePanel(props: NodePanelProps) {
  const { doc, node, commit, onError, track, faces, turn, header, fallback, missingTakeout, extra } = props;
  const labels = KIND_LABELS;
  const edit = (change: (n: PipeNode, d: IsoDocument) => void) => commit((d) => change(getNode(d, node.id), d));
  const edges = connected(doc, node.id), code = nodeCode(doc, node) ?? "", type = COMPONENT_TYPE_BY_CODE[code];
  const item = nodeItem(doc, node), units = doc.units, imperial = units === "imperial";
  const typeLabel = COMPONENT_TYPES.find((t) => t.code === node.component)?.label ?? labels[node.kind];
  const port = (r: PipeRun) => `${sizeFor(doc, r.nps)} going ${directionName(sub(getNode(doc, r.from === node.id ? r.to : r.from).position, node.position))}`;
  const hasTakeout = !NO_TAKEOUT.includes(node.kind);
  const source = dimensionSource(doc, node);
  const specTakeout = item && !NO_TAKEOUT.includes(node.kind)
    ? `${item.source.startsWith("ASME") || item.id.startsWith("std:") ? "Standard" : "Specification"} takeout ${formatAllowance(item.takeout, units)}`
      + (item.branchTakeout != null ? ` · branch ${formatAllowance(item.branchTakeout, units)}` : "")
      + (item.faceToFace != null ? ` · face to face ${formatAllowance(item.faceToFace, units)}` : "")
    : "";
  const measured = (
    <LengthInput aria="Measured takeout" mm={node.takeout} units={units} precision="fine" allowEmpty onError={onError}
      placeholder={item && Number.isFinite(item.takeout) ? formatAllowance(item.takeout, units) : missingTakeout ? "Required" : "From spec"}
      onCommit={(v) => edit((n) => { n.takeout = v; })} />
  );

  // On a pipe end (one pipe) the choices are what can end a pipe, and an open end again.
  const oneEnd = edges.length === 1 && !node.associatedRunId;
  const typeChoices = COMPONENT_TYPES.filter((t) =>
    turn ? ["elbow90", "elbow45"].includes(t.kind) || !!t.angle
      : node.kind === "end" || oneEnd ? t.kind === "cap" || t.kind === "flange" || (t.kind === node.kind && !t.angle)
        : (t.kind === node.kind && !t.angle) || (["elbow90", "elbow45"].includes(node.kind) && ["elbow90", "elbow45"].includes(t.kind)));
  const changeType = (value: string) => commit((d) => {
    if (value === OPEN_END) return toOpenEnd(d, node.id);
    const n = getNode(d, node.id), t = COMPONENT_TYPES.find((x) => x.code === value);
    if (!t) return;
    // An angle or relief valve takes the turn's place; an elbow put back is a turn again.
    if (t.angle) { placeAtTurn(d, n.id, t, n.branchEdgeId); return; }
    if (COMPONENT_TYPES.find((x) => x.code === n.component)?.angle) delete n.branchEdgeId;
    const run = d.runs.find((r) => r.id === header?.id);
    // A reducer or tee keeps its sizes when its type changes, concentric to eccentric say.
    const smaller = n.kind === "reducer" ? Math.min(...connected(d, n.id).map((r) => r.nps))
      : n.kind === "tee" ? d.runs.find((r) => r.id === n.branchEdgeId)?.nps : undefined;
    const row = run ? getSpec(d, run.specId).fittings.find((f) => rowComponent(f)?.code === t.code && f.nps === run.nps && (smaller == null || (f.smallerNps ?? f.nps) === smaller)) : undefined;
    applyComponent(d, n, t.code, row);
    if (!ECCENTRIC.test(t.code)) delete n.flatSide;
  });
  // An olet's rows are its branch sizes on the pipe it sits on; other components', the size of their largest pipe.
  const oletHost = node.kind === "olet" ? doc.runs.find((r) => r.id === node.associatedRunId) : undefined;
  const catalogue = getSpec(doc, oletHost?.specId ?? header?.specId ?? fallback.specId).fittings.filter((f) =>
    (node.component ? rowComponent(f)?.code === node.component : f.kind === node.kind) &&
    (oletHost ? (f.smallerNps ?? f.nps) < oletHost.nps && (f.smallerNps == null || f.nps === oletHost.nps) : f.nps === (header?.nps ?? fallback.nps)));

  // Flanged joints and flanged-end bodies.
  const joints = flangedJoints(doc).filter((j) => j.nodeId === node.id);
  const spec = edges[0] ? getSpec(doc, edges[0].specId) : undefined;
  // Mating flanges the specification lists at this size; without any, every mating flange type in the catalogue.
  const mating = (code?: string) => !!code && !/BL$|ORFC|SBLND/.test(code);
  const specFlanges = spec?.fittings.filter((f) => f.kind === "flange" && f.nps === edges[0]?.nps && mating(f.component)).map((f) => f.component!) ?? [];
  const flangeChoices = [...new Set(specFlanges.length ? specFlanges : COMPONENT_TYPES.filter((t) => t.kind === "flange" && mating(t.code)).map((t) => t.code))];
  const flangeJoint = node.kind === "flange" && edges.length === 1 && type?.endPrep !== "FL";
  const supply = { gasket: true, bolts: true, ...node.jointSupply };
  const setSupply = (change: Partial<NonNullable<PipeNode["jointSupply"]>>) => edit((n) => { n.jointSupply = { ...supply, ...change }; });
  const lap = isLapJoint(code);

  const fabrication = (
    <>
      <Section id="node.component" title="Component" defaultOpen summary={typeLabel}>
        <Row label="Type" keywords="component kind">
          <select aria-label="Component type" value={node.component ?? ""} onChange={(e) => changeType(e.target.value)}>
            {!node.component && <option value="">{labels[node.kind]}</option>}
            {oneEnd && node.kind !== "end" && <option value={OPEN_END}>Open end</option>}
            {typeChoices.map((t) => <option value={t.code} key={t.code}>{t.label}</option>)}
          </select>
        </Row>
        {turn && COMPONENT_TYPES.find((t) => t.code === node.component)?.angle && (
          <Row label="Outlet" keywords="angle valve branch">
            <select aria-label="Angle body outlet" value={node.branchEdgeId ?? ""}
              onChange={(e) => commit((d) => { const n = getNode(d, node.id); placeAtTurn(d, n.id, COMPONENT_TYPES.find((t) => t.code === n.component)!, e.target.value); })}>
              {edges.map((r) => <option key={r.id} value={r.id}>{port(r)}</option>)}
            </select>
          </Row>
        )}
        <Row label="Catalogue" keywords="catalog specification row rating schedule">
          <select aria-label="Component catalogue row" value={node.catalogId ?? ""}
            onChange={(e) => edit((n, d) => {
              const row = d.specs.flatMap((s) => s.fittings).find((f) => f.id === e.target.value);
              if (row?.component) applyComponent(d, n, row.component, row);
              else n.catalogId = e.target.value || undefined;
              if (!ECCENTRIC.test(n.component ?? "")) delete n.flatSide;
            })}>
            <option value="">Custom / measured</option>
            {catalogue.map((f) => (
              <option key={f.id} value={f.id}>{[f.smallerNps ? sizeFor(doc, f.nps, f.smallerNps) : oletHost ? sizeFor(doc, oletHost.nps, f.nps) : "", f.rating, f.schedule, f.description].filter(Boolean).join(" · ")}</option>
            ))}
          </select>
        </Row>
        <Row label="Description" keywords="material text bom">
          <TextInput aria="Component description" value={node.description} placeholder={item?.description ?? "As the catalogue"} onCommit={(v) => edit((n) => { n.description = v; })} />
        </Row>
        {ECCENTRIC.test(code) && (
          <Row label="Flat side" keywords="eccentric fot fob" hint="Flat on top keeps vapour out of a pump suction; flat on bottom lets a line drain.">
            <select aria-label="Eccentric flat side" value={node.flatSide ?? ""}
              onChange={(e) => commit((d) => setFlatSide(d, node.id, (e.target.value || undefined) as FlatSide | undefined))}>
              <option value="">Not stated</option>
              <option value="top">Flat on top (FOT)</option>
              <option value="bottom">Flat on bottom (FOB)</option>
              {(["north", "south", "east", "west"] as const).map((side) => <option key={side} value={side}>Flat to the {side} (riser)</option>)}
            </select>
          </Row>
        )}
      </Section>

      {track && (
        <Section id="node.position" title="Position on pipe" defaultOpen summary={`${round(track.distance / track.length * 100)}% along`}>
          <Row label="Centre along pipe" keywords="position percent" hint="Or drag it along the pipe; the pipe ends stay fixed.">
            <NumberInput aria="Component position percent" min={0.01} max={99.99} suffix="%" value={round(track.distance / track.length * 100)} onError={onError}
              onCommit={(v) => { if (v != null) commit((d) => moveComponentAlongPipe(d, node.id, track.length * v / 100)); }} />
          </Row>
          {faces && (
            <Note keywords="face to face">
              The sheet dimensions this {node.kind === "reducer" ? "reducer to its ends" : "component to its mating flange faces, across the gaskets"}:
              {" "}{formatLength(faces[1] - faces[0], units)} face to face, centre {formatLength(track.distance, units)} from the start.
            </Note>
          )}
        </Section>
      )}

      <Section id="node.takeouts" title="Takeouts" defaultOpen={missingTakeout} summary={missingTakeout ? "Missing" : node.takeout != null ? "Measured" : "From spec"}>
        {missingTakeout && <Note tone="warn" keywords="takeout missing">No known takeout. Enter the centre-to-pipe-end distance so the pipe cuts can be calculated; set individual ports below if they differ.</Note>}
        {specTakeout && <Note keywords="takeout spec standard">{specTakeout}</Note>}
        {item?.assumed && node.takeout == null && <Note tone="warn" keywords="takeout assumed standard">Assumed: {item.assumed}. Confirm it against the manufacturer's data, or enter the measured takeout.</Note>}
        {!hasTakeout && <Row label="Measured takeout" keywords="takeout">{measured}</Row>}
        {/BEND/.test(node.component ?? "") && (
          <Row label="Bend radius" keywords="takeout" modified={node.bendRadius != null} onReset={() => edit((n) => { delete n.bendRadius; })}>
            <LengthInput aria="Bend radius" mm={node.bendRadius} units={units} allowEmpty onError={onError} placeholder="e.g. 5D or a length"
              title="Centreline radius: a multiple of the pipe's outside diameter (5D, 3D, 1.5D) or a length"
              parse={(raw) => parseBendRadius(raw, units, edges[0] && (getSpec(doc, edges[0].specId).sizes.find((s) => s.nps === edges[0].nps)?.od ?? pipeOd(edges[0].nps)))}
              onCommit={(v) => edit((n) => { if (v) n.bendRadius = v; else delete n.bendRadius; })} />
          </Row>
        )}
        {BRANCHED(node.kind, code) && (
          <Row label="Branch takeout" keywords="takeout tee olet lateral" modified={node.branchTakeout != null} onReset={() => edit((n) => { n.branchTakeout = undefined; })}>
            <LengthInput aria="Branch takeout" mm={node.branchTakeout} units={units} precision="fine" allowEmpty onError={onError}
              onCommit={(v) => edit((n) => { n.branchTakeout = v; })} />
          </Row>
        )}
        {edges.map((r, i) => (
          <Row key={r.id} label={`Port ${i + 1} · ${port(r)}`} keywords="takeout port" modified={node.portTakeouts?.[r.id] != null}
            onReset={() => edit((n) => { if (n.portTakeouts) delete n.portTakeouts[r.id]; })}>
            <LengthInput aria={`Port ${i + 1} takeout`} mm={node.portTakeouts?.[r.id]} units={units} precision="fine" allowEmpty onError={onError}
              onCommit={(v) => edit((n) => { n.portTakeouts ??= {}; if (v == null) delete n.portTakeouts[r.id]; else n.portTakeouts[r.id] = v; })} />
          </Row>
        ))}
      </Section>

      {flangeJoint && (
        <Section id="node.joint" title="Flanged joint" defaultOpen summary={[supply.flange !== false && "flange", supply.gasket && "gasket", supply.bolts && "bolts"].filter(Boolean).join(" · ") || "Nothing supplied"}>
          <Toggle label={lap ? "Supply lap-joint flange" : "Supply the flange"} keywords="joint supply" hint={lap ? "The stub end is always listed." : undefined}
            checked={supply.flange !== false} onChange={(on) => setSupply({ flange: on })} />
          <Toggle label="Supply the gasket" aria="Supply the gasket for this joint" keywords="joint supply" checked={supply.gasket} onChange={(on) => setSupply({ gasket: on })} />
          <Toggle label="Supply the bolts" aria="Supply the bolts for this joint" keywords="joint supply studs" checked={supply.bolts} onChange={(on) => setSupply({ bolts: on })} />
          <Row label="Bolts to" keywords="joint mate lug studs">
            <select aria-label="Joint mate" value={supply.mate ?? "flange"} onChange={(e) => setSupply({ mate: e.target.value as "flange" | "lug" })}>
              <option value="flange">A flange (studs through both)</option>
              <option value="lug">A lug valve or tapped nozzle</option>
            </select>
          </Row>
          <Row label="End point" keywords="joint measured to face gasket">
            <select aria-label="Joint measured to" value={supply.measuredTo ?? "flange"} onChange={(e) => setSupply({ measuredTo: e.target.value as "mate" | "flange" })}>
              <option value="flange">This flange's face</option>
              <option value="mate">The face it bolts to (gasket allowed)</option>
            </select>
          </Row>
          <JointSummary joints={joints} units={units} />
        </Section>
      )}

      {type?.endPrep === "FL" && edges.length > 0 && (
        <Section id="node.ends" title="Flanged ends" defaultOpen>
          {edges.map((run, i) => {
            const choice = node.portFlanges?.[run.id];
            const set = (change: Partial<NonNullable<PipeNode["portFlanges"]>[string]>) =>
              edit((n) => { n.portFlanges = { ...n.portFlanges, [run.id]: { ...n.portFlanges?.[run.id], ...change } }; });
            return (
              <Group key={run.id} title={`End ${i + 1} · ${port(run)}`}>
                <Row label="Mates with" keywords="flange mating">
                  <select aria-label={`Mating flange ${i + 1}`} value={choice?.component ?? ""} onChange={(e) => set({ component: e.target.value || undefined })}>
                    <option value="">Specification flange</option>
                    {flangeChoices.map((c) => <option key={c} value={c}>{COMPONENT_TYPES.find((t) => t.code === c)?.label ?? c}</option>)}
                    <option value="NONE">Not supplied (existing)</option>
                  </select>
                </Row>
                <Row label="Bolting" keywords="bolting makeup studs lug" group>
                  <Segmented aria={`Bolting makeup ${i + 1}`} value={choice?.mate ?? "flange"} onChange={(v) => set({ mate: v })}
                    choices={[{ value: "flange", label: "Studs", title: "Through studs" }, { value: "lug", label: "Lug bolts", title: "Lug bolts into a tapped body" }]} />
                </Row>
                <Toggle label="Gasket" aria={`Gasket ${i + 1}`} keywords="flange supply" checked={choice?.gasket !== false} onChange={(on) => set({ gasket: on })} />
                <Toggle label="Bolts" aria={`Bolts ${i + 1}`} keywords="flange supply" checked={choice?.bolts !== false} onChange={(on) => set({ bolts: on })} />
              </Group>
            );
          })}
          <JointSummary joints={joints} units={units} />
        </Section>
      )}

      <Section id="node.estimate" title="Estimating" summary={[node.quantity != null && `qty ${node.quantity}`, node.weightKg != null && `${round(node.weightKg / (imperial ? KG_PER_LB : 1))} ${imperial ? "lb" : "kg"}`].filter(Boolean).join(" · ")}>
        {/* Stored in kilograms and square metres; shown in the drawing's units. */}
        {([
          ["weightKg", "Weight", imperial ? "lb" : "kg", "mass", imperial ? KG_PER_LB : 1],
          ["areaM2", "Surface area", imperial ? "ft²" : "m²", "paint coating", imperial ? M2_PER_FT2 : 1],
          ["unitCost", "Unit cost", "", "price", 1],
          ["laborHours", "Labour hours", "h", "labor time", 1],
          ["quantity", "Quantity", "", "count", 1],
        ] as const).map(([k, label, suffix, keywords, factor]) => (
          <Row key={k} label={label} keywords={`estimating fabrication ${keywords}`} modified={node[k] != null} onReset={() => edit((n) => { n[k] = undefined; })}>
            <NumberInput aria={"Component " + label.toLowerCase()} min={0} suffix={suffix} value={node[k] == null ? undefined : node[k]! / factor} decimals={3} onError={onError}
              integer={k === "quantity"} onCommit={(v) => edit((n) => { n[k] = v == null ? undefined : v * factor; })} />
          </Row>
        ))}
      </Section>
      {extra}
    </>
  );

  const annotation = <NodeAnnotation {...props} code={code} edges={edges} joints={joints} />;

  return (
    <>
      {(track || hasTakeout) && (
        <Metrics>
          {track && (
            <Metric unit={units === "mm" ? "mm" : undefined} label={faces ? "Near face from start" : "Centre from start"} hint="Along the straight, from its start">
              {/* The distance is given to what the sheet dimensions: flanged faces and reducer ends, else the centre. */}
              <LengthInput aria="Component distance from start" mm={round(faces ? faces[0] : track.distance, 3)} units={units} onError={onError}
                onCommit={(v) => v != null && commit((d) => moveComponentAlongPipe(d, node.id, v + (faces ? track.distance - faces[0] : 0)))} />
            </Metric>
          )}
          {hasTakeout && <Metric unit={units === "mm" ? "mm" : undefined} label={`Takeout · ${SOURCE[source]}`} hint={SOURCE_HINT[source]} modified={node.takeout != null}>{measured}</Metric>}
        </Metrics>
      )}
      <Tabbed fabrication={fabrication} annotation={annotation} />
    </>
  );
}

/** Each flanged joint as made up, where its gasket and bolting come from, and anything that had to be assumed. */
function JointSummary({ joints, units }: { joints: ReturnType<typeof flangedJoints>; units: IsoDocument["units"] }) {
  return (
    <>
      {joints.map((j, i) => (
        <div key={j.id}>
          <Note keywords="joint gasket bolts">
            Joint {joints.length > 1 ? i + 1 : ""}: {j.flanges.map((f) => (isLapJoint(f.code) ? "lap-joint flange + stub end" : COMPONENT_TYPES.find((t) => t.code === f.code)?.label.toLowerCase() ?? f.code)).join(", ") || "existing flange"}
            {j.gasket ? ` · gasket ${draftLength(j.gasket.thickness, units)} thick${j.supplied.gasket ? "" : " (by others)"}` : " · no gasket"}
            {j.bolts ? ` · ${j.bolts.count} ${j.bolts.kind === "lug" ? "lug bolts" : j.bolts.kind === "machine" ? "machine bolts" : "studs"} ${boltSizeText(j.bolts.diameter, j.bolts.length)}${j.supplied.bolts ? "" : " (by others)"}` : " · no bolts"}
          </Note>
          {(j.gasket || j.bolts) && (
            <Note keywords="joint gasket bolts source standard">
              {[j.gasket && `Gasket from ${j.gasket.source}`, j.bolts && `bolting from ${j.bolts.source}`].filter(Boolean).join("; ")}.
            </Note>
          )}
          {j.boltsUnknown && <Note tone="warn" keywords="joint bolts unknown">Neither the specification nor the standard sizes this joint's bolting. Add a bolt row to the specification.</Note>}
          {j.assumed.map((a) => <Note key={a} tone="warn" keywords="joint assumed class face gasket bolts">Assumed: {a}.</Note>)}
        </div>
      ))}
    </>
  );
}

/** How the sheet calls the component out: labels and symbols, its tie-in, and where it sits on the paper. */
function NodeAnnotation({ doc, node, commit, onError, sheetPoint, code, edges, joints }: NodePanelProps & {
  code: string; edges: PipeRun[]; joints: ReturnType<typeof flangedJoints>;
}) {
  const referenceInput = useRef<HTMLInputElement>(null);
  const paper = paperUnits(doc);
  const [referenceError, setReferenceError] = useState("");
  const edit = (change: (n: PipeNode) => void) => commit((d) => change(getNode(d, node.id)));
  const type = COMPONENT_TYPE_BY_CODE[code];
  const open = edges.length === 1 && !node.associatedRunId;
  const paperRun = edges[0] ?? doc.runs.find((r) => r.id === node.associatedRunId);
  const kind = node.kind, valve = kind === "valve", support = kind === "support", note = kind === "annotation";
  const references = (doc.references ?? []).filter((r) => r.atNodeId === node.id);
  const editReference = (id: string, change: (r: NonNullable<IsoDocument["references"]>[number]) => void) =>
    commit((d) => change(d.references!.find((x) => x.id === id)!));
  const dimensioned = support ? node.dimensioned !== false : note && !!node.dimensioned;
  // What the sheet draws it as: its family, or the drafter's choice of another.
  const symbol = symbolOf(doc, node), own = COMPONENT_TYPE_BY_CODE[code]?.symbol ?? KIND_SYMBOL[kind];
  const hasSymbol = kind !== "end" && kind !== "weld";

  return (
    <>
      <Section id="node.callout" title="Callout" defaultOpen>
        <Row label="Size label" keywords="size label ns nps dn nominal" group>
          <Segmented aria="Fitting size label" value={tri(node.showSize)} onChange={(v) => edit((n) => { n.showSize = untri(v); })}
            choices={[{ value: "", label: "Auto" }, { value: "true", label: "Show", title: "Prefer this fitting for the size label" }, { value: "false", label: "Hide" }]} />
        </Row>
        {edges.some((r) => r.nps !== edges[0]?.nps) && (
          <Row label="Size format" keywords="nominal size compact" group>
            <Segmented aria="Nominal size format" value={node.sizeLabelFormat ?? "standard"} onChange={(v) => edit((n) => { n.sizeLabelFormat = v; })}
              choices={[{ value: "standard", label: "Standard" }, { value: "compact", label: "Compact" }]} />
          </Row>
        )}
        {valve && (
          <>
            <Row label="Valve tag" keywords="tag number">
              <TextInput aria="Valve tag" value={node.tag} placeholder="e.g. HV-101" onCommit={(t) => edit((n) => { n.tag = t.trim() || undefined; })} />
            </Row>
            <Row label="Operator" keywords="valve operator direction">
              <select aria-label="Valve operator" value={node.operator ?? ""} onChange={(e) => edit((n) => { n.operator = e.target.value || undefined; })}>
                <option value="">Not shown</option>
                {OPERATORS.map((o) => <option key={o}>{o}</option>)}
                {node.operator && !OPERATORS.includes(node.operator) && <option>{node.operator}</option>}
              </select>
            </Row>
            <Row label="Callout order" keywords="valve item tag operator">
              <select aria-label="Valve callout order" value={node.calloutOrder ?? "item-first"} onChange={(e) => edit((n) => { n.calloutOrder = e.target.value as PipeNode["calloutOrder"]; })}>
                <option value="item-first">Item, operator, tag</option>
                <option value="item-tag-first">Item, tag, operator</option>
                <option value="tag-first">Tag, operator, item</option>
              </select>
            </Row>
          </>
        )}
        {(support || note) && (
          <>
            <Row label="Label" keywords="support annotation text callout">
              <TextInput aria="Label" value={node.calloutText} placeholder={type?.label.toUpperCase()} onCommit={(t) => edit((n) => { n.calloutText = t.trim() || undefined; })} />
            </Row>
            <Toggle label="Dimension its location" keywords="support annotation" checked={dimensioned}
              onChange={(on) => edit((n) => { n.dimensioned = support ? (on ? undefined : false) : on || undefined; })} />
            {dimensioned && <Toggle label="Approximate (±)" keywords="location" checked={!!node.approximate} onChange={(on) => edit((n) => { n.approximate = on || undefined; })} />}
          </>
        )}
        {kind === "tee" && (
          <Row label="Branch dimensions" keywords="tier chain tee">
            <select aria-label="Branch dimension tier" value={node.dimensionChain ?? "both"} onChange={(e) => edit((n) => { n.dimensionChain = e.target.value as "both" | "body" | "mate"; })}>
              <option value="both">Both chains</option>
              <option value="body">Body-face chain</option>
              <option value="mate">Mating flange-face chain</option>
            </select>
          </Row>
        )}
        <Row label="Elevation (℄ EL)" keywords="centreline elevation callout" group>
          <Segmented aria="Elevation callout" value={node.elevationCallout == null ? "auto" : node.elevationCallout ? "show" : "hide"}
            onChange={(v) => edit((n) => { n.elevationCallout = v === "auto" ? undefined : v === "show"; })}
            choices={[{ value: "auto", label: "Auto" }, { value: "show", label: "Show" }, { value: "hide", label: "Hide" }]} />
        </Row>
        <Row label="Tie point" keywords="tp hexagon">
          <TextInput aria="Tie point" value={node.tiePoint?.id} placeholder="e.g. TP-3" onCommit={(id) => edit((n) => { n.tiePoint = id.trim() ? { ...n.tiePoint, id: id.trim() } : undefined; })} />
        </Row>
        {node.tiePoint && (
          <Row label="Tie point note" keywords="tp">
            <TextInput aria="Tie point note" value={node.tiePoint.label} placeholder="e.g. EXIST. FLANGE"
              onCommit={(label) => edit((n) => { n.tiePoint = { ...n.tiePoint!, label: label.trim() || undefined }; })} />
          </Row>
        )}
      </Section>

      {hasSymbol && (
        <Section id="node.symbol" title="Symbol" defaultOpen summary={node.symbol ? `Drawn as ${familyName(node.symbol)}` : undefined}>
          <Row label="Drawn as" keywords="symbol family override" modified={!!node.symbol} onReset={() => edit((n) => { delete n.symbol; })}>
            <select aria-label="Drawn symbol" value={node.symbol ?? ""} onChange={(e) => edit((n) => { if (e.target.value) n.symbol = e.target.value as SymbolFamily; else delete n.symbol; })}>
              <option value="">As the component ({familyName(own)})</option>
              {SYMBOL_FAMILIES.filter((f) => f !== own).map((f) => <option key={f} value={f}>{familyName(f)}</option>)}
            </select>
          </Row>
          {["valve", "flange", "reducer", "cap"].includes(kind) && (
            <Row label="Symbol plane" keywords="fitting orientation">
              <select aria-label="Fitting symbol plane" value={node.symbolPlane ?? ""} onChange={(e) => edit((n) => { n.symbolPlane = (e.target.value || undefined) as PipeNode["symbolPlane"]; })}>
                <option value="">Automatic</option>
                <option value="plan">Plan</option>
                <option value="vertical">Vertical</option>
                <option value="alternate">Other isometric plane</option>
              </select>
            </Row>
          )}
          {valve && (
            <Row label="Operator symbol" keywords="valve actuator handwheel lever">
              <select aria-label="Valve operator symbol" value={node.valveOperator ?? ""} onChange={(e) => edit((n) => { n.valveOperator = (e.target.value || undefined) as PipeNode["valveOperator"]; })}>
                <option value="">Automatic</option>
                <option value="none">None</option>
                <option value="lever">Lever</option>
                <option value="actuator">Actuator</option>
                <option value="handwheel">Handwheel</option>
                <option value="box">Box actuator</option>
              </select>
            </Row>
          )}
          {symbol === "butterfly" && (
            <Row label="Butterfly symbol" keywords="valve disc bowtie" group>
              <Segmented aria="Butterfly valve symbol" value={node.valveSymbol ?? ""} onChange={(v) => edit((n) => { n.valveSymbol = (v || undefined) as PipeNode["valveSymbol"]; })}
                choices={[{ value: "", label: "Auto" }, { value: "disc", label: "Disc", title: "Disc and lever" }, { value: "bowtie", label: "Bow-tie" }]} />
            </Row>
          )}
          {symbol === "check" && (
            <Row label="Check symbol" keywords="valve swing triangle" group>
              <Segmented aria="Check valve symbol" value={node.valveSymbol ?? ""} onChange={(v) => edit((n) => { n.valveSymbol = (v || undefined) as PipeNode["valveSymbol"]; })}
                choices={[{ value: "", label: "Auto" }, { value: "swing", label: "Swing" }, { value: "triangle", label: "Triangle" }]} />
            </Row>
          )}
          {support && (
            <Row label="Support mark" keywords="symbol caption" group>
              <Segmented aria="Support mark" value={node.supportSymbol ?? "standard"} onChange={(v) => edit((n) => { n.supportSymbol = v; })}
                choices={[{ value: "standard", label: "Symbol", title: "Symbol and caption" }, { value: "callout", label: "Caption", title: "Arrowed caption only" }]} />
            </Row>
          )}
          {support && node.associatedRunId && (
            <Toggle label="Align lettering with pipe" aria="Align support lettering with pipe" keywords="support plane" checked={node.calloutPlane === "pipe"}
              onChange={(on) => edit((n) => { n.calloutPlane = on ? "pipe" : undefined; })} />
          )}
          {/^ISA/.test(code) && (
            <Toggle label="Bubble in the pipe plane" aria="Draw instrument bubble in the pipe plane" keywords="instrument isa" checked={node.calloutPlane === "pipe"}
              onChange={(on) => edit((n) => { n.calloutPlane = on ? "pipe" : undefined; })} />
          )}
          {/INS-LIM/.test(code) && (
            <Row label="Limit lettering" keywords="insulation">
              <select aria-label="Insulation limit lettering" value={node.calloutPlane ?? ""} onChange={(e) => edit((n) => { n.calloutPlane = (e.target.value || undefined) as PipeNode["calloutPlane"]; })}>
                <option value="">Along pipe</option>
                <option value="sheet">Upright on sheet</option>
                <option value="pipe">Pipe plane</option>
              </select>
            </Row>
          )}
          {code === "EQUIP" && (
            <Row label="Equipment outline" keywords="shape vessel pump">
              <select aria-label="Equipment outline shape" value={node.equipmentShape ?? ""} onChange={(e) => edit((n) => { n.equipmentShape = (e.target.value || undefined) as PipeNode["equipmentShape"]; })}>
                <option value="">Generic casing</option>
                <option value="vessel">Vessel on a skid</option>
                <option value="pump">Pump end view</option>
              </select>
            </Row>
          )}
        </Section>
      )}

      {/^HOSE/.test(code) && (
        <Section id="node.hose" title="Hose route" defaultOpen summary={node.hosePath ? `${node.hosePath.length} points` : "Automatic"}>
          {node.hosePath && <Note keywords="hose route grips">Drag the route's grips on the sheet; drag a midpoint grip to add a point.</Note>}
          <Row label="Route points" keywords="hose path paper" hint={`On the sheet from its lower-left corner, ${paper.unit}: x, y; x, y`} modified={!!node.hosePath} onReset={() => edit((n) => { n.hosePath = undefined; })}>
            <TextInput aria="Hose route (x, y; x, y)" value={pathText(node.hosePath, paper)} placeholder="Automatic"
              onCommit={(raw) => { const p = parsePath(raw, paper); if (p === null) return onError("Enter at least two x, y points separated by semicolons."); edit((n) => { n.hosePath = p; }); }} />
          </Row>
        </Section>
      )}

      {open && (
        <Section id="node.continuation" title="Continuation" defaultOpen summary={node.continuation ? node.continuation.text.split("\n")[0] : "None"}>
          <Row label={node.continuation ? "Replace note" : "Add note"} keywords="continuation template contd connect closed">
            <select aria-label="Continuation template" value=""
              onChange={(e) => e.target.value && edit((n) => { n.continuation = { text: e.target.value, coordinates: n.continuation?.coordinates ?? true }; })}>
              <option value="">Choose a template…</option>
              {TEMPLATES.map((t) => <option key={t} value={t}>{t.replace("\n", " ")}</option>)}
            </select>
          </Row>
          {node.continuation && (
            <>
              <Row label="Note text" keywords="continuation" stack>
                <TextInput aria="Continuation text" multiline value={node.continuation.text}
                  onCommit={(text) => edit((n) => { n.continuation = text.trim() ? { ...n.continuation!, text } : undefined; })} />
              </Row>
              <Row label="Beyond the end" keywords="continuation termination open closed continues" group>
                <Segmented aria="Continuation termination" value={node.continuation.termination ?? "continues"}
                  onChange={(v) => edit((n) => { n.continuation = { ...n.continuation!, termination: v === "continues" ? undefined : v }; })}
                  choices={[{ value: "continues", label: "Continues", title: "On another drawing or existing pipe: drawn on to a break" }, { value: "open", label: "Open" }, { value: "closed", label: "Closed" }]} />
              </Row>
              <Toggle label="Plant coordinates (E/N/EL)" aria="Show plant coordinates (E/N/EL)" keywords="continuation" checked={node.continuation.coordinates !== false}
                onChange={(on) => edit((n) => { n.continuation = { ...n.continuation!, coordinates: on }; })} />
              {node.kind === "flange" && type?.endPrep !== "FL" && (
                <Row label="Coordinate at" keywords="continuation face">
                  <select aria-label="Continuation coordinate face" value={node.continuation.coordinateFace ?? ""}
                    onChange={(e) => edit((n) => { n.continuation = { ...n.continuation!, coordinateFace: (e.target.value || undefined) as "flange" | "mate" | undefined }; })}>
                    <option value="">The dimension end point</option>
                    <option value="flange">This flange's face</option>
                    <option value="mate">The mating face</option>
                  </select>
                </Row>
              )}
              <Group title="Route on paper">
                {node.continuation.paperPath && <Note keywords="continuation route grips">Drag the route's grips on the sheet; drag a midpoint grip to add a point.</Note>}
                <Row label="Route points" keywords="continuation path" hint={`On the sheet from its lower-left corner, ${paper.unit}: x, y; x, y`} modified={!!node.continuation.paperPath}
                  onReset={() => edit((n) => { n.continuation = { ...n.continuation!, paperPath: undefined }; })}>
                  <TextInput aria="Route points (x, y; x, y)" value={pathText(node.continuation.paperPath, paper)} placeholder="Straight"
                    onCommit={(raw) => { const p = parsePath(raw, paper, 10000); if (p === null) return onError("Enter at least two x, y points separated by semicolons."); edit((n) => { n.continuation = { ...n.continuation!, paperPath: p }; }); }} />
                </Row>
                <Row label="Note points to" keywords="continuation leader" group>
                  <Segmented aria="Continuation note target" value={node.continuation.leaderAt ?? "end"} onChange={(v) => edit((n) => { n.continuation = { ...n.continuation!, leaderAt: v }; })}
                    choices={[{ value: "end", label: "Route end" }, { value: "node", label: "Endpoint", title: "Model endpoint" }]} />
                </Row>
                <Row label="Route end" keywords="continuation marker break tube" group>
                  <Segmented aria="Continuation route end" value={node.continuation.endMarker ?? "plain"} onChange={(v) => edit((n) => { n.continuation = { ...n.continuation!, endMarker: v }; })}
                    choices={[{ value: "plain", label: "Plain" }, { value: "break", label: "Break" }, { value: "tube", label: "Tube" }]} />
                </Row>
              </Group>
            </>
          )}
        </Section>
      )}

      {open && (
        <Section id="node.adjacent" title="Adjacent drawing" summary={references.length ? references.map((r) => r.name).join(", ") : "None"}>
          <Actions keywords="adjacent drawing link reference">
            <button type="button" onClick={() => referenceInput.current?.click()}>{references.length ? "Replace linked drawing…" : "Link a .piping drawing…"}</button>
          </Actions>
          <input ref={referenceInput} type="file" accept=".piping,.json" hidden onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              const source = parseIsoJson(await file.text());
              const reference = drawingReference(doc, node.id, source);
              commit((d) => { d.references = [...(d.references ?? []).filter((r) => r.atNodeId !== node.id), reference]; pruneSheetAnchors(d); });
              setReferenceError("");
            } catch (error) {
              setReferenceError(error instanceof Error ? error.message : "Could not open the adjacent drawing.");
            }
          }} />
          {referenceError && <Note tone="warn">{referenceError}</Note>}
          {references.map((r) => (
            <Group key={r.id} title={r.name}>
              <Note>Shown for context; excluded from material and weld quantities.</Note>
              <Row label="Context parts" keywords="adjacent components">
                <select aria-label="Adjacent components shown" value={r.components ?? 1} onChange={(e) => editReference(r.id, (x) => { x.components = Number(e.target.value); })}>
                  <option value={0}>Pipe only</option>
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Row>
              <Row label="Context weight" keywords="adjacent line" group>
                <Segmented aria="Adjacent pipe weight" value={r.pipeWeight ? "pipe" : "fine"} onChange={(v) => editReference(r.id, (x) => { x.pipeWeight = v === "pipe"; })}
                  choices={[{ value: "fine", label: "Fine" }, { value: "pipe", label: "Pipe" }]} />
              </Row>
              <Row label="Context end" keywords="adjacent termination" group>
                <Segmented aria="Adjacent drawing end" value={r.termination ?? "break"} onChange={(v) => editReference(r.id, (x) => { x.termination = v; })}
                  choices={[{ value: "break", label: "Break" }, { value: "plain", label: "Plain" }]} />
              </Row>
              <Toggle label="Adjacent line number" aria="Show adjacent line number" keywords="adjacent" checked={r.runs.some((run) => run.showLineNumber === true)}
                onChange={(on) => editReference(r.id, (x) => { for (const run of x.runs) run.showLineNumber = on ? true : undefined; })} />
              <Row label="Dimension to" keywords="adjacent">
                <select aria-label="Adjacent dimension point" value={r.dimensionTo ?? ""}
                  onChange={(e) => commit((d) => { d.references!.find((x) => x.id === r.id)!.dimensionTo = e.target.value || undefined; pruneSheetAnchors(d); })}>
                  <option value="">No dimension into it</option>
                  {r.nodes.filter((n) => n.id !== r.anchorNodeId && !["end", "weld", "annotation", "support"].includes(n.kind)).map((n, i) => (
                    <option key={n.id} value={n.id}>{n.tag || COMPONENT_TYPE_BY_CODE[n.component ?? ""]?.label || n.kind} {i + 1}</option>
                  ))}
                </select>
              </Row>
              <Actions keywords="adjacent remove">
                <button type="button" className="is-danger" onClick={() => commit((d) => { d.references = d.references?.filter((x) => x.id !== r.id); pruneSheetAnchors(d); })}>Remove adjacent drawing</button>
              </Actions>
            </Group>
          ))}
        </Section>
      )}

      {joints.length > 0 && (
        <Section id="node.joint-items" title="Joint item callouts" summary="Automatic">
          <Note>Reference an existing material item on this sheet. Supply quantities stay as set under Fabrication.</Note>
          {joints.map((j, i) => (
            <Group key={j.id} title={`Joint ${joints.length > 1 ? i + 1 : ""}`.trim()}>
              {(["flange", "bolts", "gasket"] as const).map((part) => (
                <Row key={part} label={`${part[0].toUpperCase() + part.slice(1)} item`} keywords="joint callout bom">
                  <select aria-label={`Joint ${i + 1} ${part} item`} value={doc.sheets?.[j.spool]?.jointItems?.[j.id]?.[part] ?? ""}
                    onChange={(e) => commit((d) => {
                      const info = ((d.sheets ??= {})[j.spool] ??= {}), held = ((info.jointItems ??= {})[j.id] ??= {});
                      if (e.target.value) held[part] = e.target.value;
                      else delete held[part];
                    })}>
                    <option value="">Automatic</option>
                    {sheetMaterials(doc, j.spool).filter((r) => r.category === (part === "bolts" ? "bolt" : part)).map((r) => (
                      <option key={r.key} value={r.key}>{r.id} · {r.nd} · {r.description}</option>
                    ))}
                  </select>
                </Row>
              ))}
            </Group>
          ))}
        </Section>
      )}

      {sheetPoint && paperRun && (
        <Section id="node.paper" title="Paper position" summary={doc.sheets?.[paperRun.spool]?.nodePositions?.[node.id] ? "Moved" : "Automatic"}>
          <Note>Arrange the sheet without changing plant coordinates or cut lengths.</Note>
          <PairHead columns={[`X · ${paper.unit}`, `Y · ${paper.unit}`]} />
          <Row label="On the sheet" keywords="paper position x y" hint="From the sheet's lower-left corner" pair>
            <PaperPointInputs point={sheetPoint} paper={paper} aria="Paper position" onError={onError}
              onCommit={(point) => commit((d) => { ((((d.sheets ??= {})[paperRun.spool] ??= {}).nodePositions ??= {})[node.id] = point); })} />
          </Row>
          <Actions keywords="paper position automatic reset">
            <button type="button" disabled={!doc.sheets?.[paperRun.spool]?.nodePositions?.[node.id]}
              onClick={() => commit((d) => { const pins = d.sheets?.[paperRun.spool]?.nodePositions; if (pins) delete pins[node.id]; })}>Reset paper position</button>
          </Actions>
        </Section>
      )}
    </>
  );
}
