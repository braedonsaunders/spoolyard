import { COMPONENT_TYPE_BY_CODE, COMPONENT_TYPES } from "../core/components";
import { flangedJoints, isLapJoint, nodeCode, nodeItem } from "../core/joints";
import { boltSizeText, draftLength } from "../core/format";
import { connected, formatAllowance, getNode, getSpec, type IsoDocument, type PipeNode } from "../core/model";

const TEMPLATES = ["CONT'D ON\nDWG# ", "CONT'D FROM\nDWG# ", "CONNECT TO ", "CLOSED"];
const OPERATORS = ["OPERATOR UP", "OPERATOR DOWN", "OPERATOR NORTH", "OPERATOR SOUTH", "OPERATOR EAST", "OPERATOR WEST"];
/** Eccentric reducers and swages, whose flat side is set as fabricated. */
export const ECCENTRIC = /^E-(RED|SWAGE|SWG)$/;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="iso-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
/** Text that commits on blur or Enter, so typing does not flood undo history. */
function Text({ label, value, multiline, placeholder, onCommit }: { label: string; value?: string; multiline?: boolean; placeholder?: string; onCommit: (value: string) => void }) {
  const props = {
    "aria-label": label,
    defaultValue: value ?? "",
    placeholder,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.target.value !== (value ?? "")) onCommit(e.target.value);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !multiline) e.currentTarget.blur();
    },
  };
  return <Row label={label}>{multiline ? <textarea key={value} rows={3} {...props} /> : <input key={value} {...props} />}</Row>;
}

/** Sheet callouts and flanged-joint makeup for the selected connection. */
export function NodeCallouts({ doc, nodeId, commit }: { doc: IsoDocument; nodeId: string; commit: (edit: (d: IsoDocument) => void) => unknown }) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const edges = connected(doc, node.id), code = nodeCode(doc, node) ?? "";
  const type = COMPONENT_TYPE_BY_CODE[code];
  const open = edges.length === 1 && !node.associatedRunId;
  const edit = (change: (n: PipeNode) => void) => commit((d) => change(getNode(d, nodeId)));
  const item = nodeItem(doc, node);
  const joints = flangedJoints(doc).filter((j) => j.nodeId === node.id);
  const spec = edges[0] ? getSpec(doc, edges[0].specId) : undefined;
  const flangeChoices = [...new Set([
    ...(spec?.fittings.filter((f) => f.kind === "flange" && f.nps === edges[0]?.nps && f.component && !/BL$|ORFC|SBLND/.test(f.component)).map((f) => f.component!) ?? []),
    "FLG-RFWN", "FLG-RFSO", "FLG-RFLJ", "FLG-FFWN", "FLG-FFLJ",
  ])];
  return (
    <div className="iso-inspector-section">
      <strong>On the sheet</strong>
      {item && node.takeout == null && !["end", "weld", "support", "annotation"].includes(node.kind) && (
        <p className="iso-help">
          {item.source.startsWith("ASME") || item.id.startsWith("std:") ? "Standard" : "Specification"} takeout {formatAllowance(item.takeout, doc.units)}
          {item.branchTakeout != null ? ` · branch ${formatAllowance(item.branchTakeout, doc.units)}` : ""}
          {item.faceToFace != null ? ` · face to face ${formatAllowance(item.faceToFace, doc.units)}` : ""}
        </p>
      )}
      {open && (
        <>
          <Row label="Continuation">
            <select
              aria-label="Continuation template"
              value=""
              onChange={(e) => e.target.value && edit((n) => { n.continuation = { text: e.target.value, coordinates: n.continuation?.coordinates ?? true }; })}
            >
              <option value="">{node.continuation ? "Replace with…" : "Add a continuation note…"}</option>
              {TEMPLATES.map((t) => <option key={t} value={t}>{t.replace("\n", " ")}</option>)}
            </select>
          </Row>
          {node.continuation && (
            <>
              <Text label="Continuation text" multiline value={node.continuation.text}
                onCommit={(text) => edit((n) => { n.continuation = text.trim() ? { ...n.continuation!, text } : undefined; })} />
              <label className="iso-check">
                <input type="checkbox" checked={node.continuation.coordinates !== false}
                  onChange={(e) => edit((n) => { n.continuation = { ...n.continuation!, coordinates: e.target.checked }; })} />
                Show plant coordinates (E/N/EL)
              </label>
            </>
          )}
        </>
      )}
      <label className="iso-check">
        <input type="checkbox" checked={!!node.elevationCallout} onChange={(e) => edit((n) => { n.elevationCallout = e.target.checked || undefined; })} />
        Centreline elevation callout (℄ EL)
      </label>
      <Text label="Tie point" value={node.tiePoint?.id} placeholder="e.g. TP-3"
        onCommit={(id) => edit((n) => { n.tiePoint = id.trim() ? { ...n.tiePoint, id: id.trim() } : undefined; })} />
      {node.tiePoint && (
        <Text label="Tie point note" value={node.tiePoint.label} placeholder="e.g. EXIST. FLANGE, FIELD WELD"
          onCommit={(label) => edit((n) => { n.tiePoint = { ...n.tiePoint!, label: label.trim() || undefined }; })} />
      )}
      {node.kind === "valve" && (
        <>
          <Row label="Operator">
            <select aria-label="Valve operator" value={node.operator ?? ""} onChange={(e) => edit((n) => { n.operator = e.target.value || undefined; })}>
              <option value="">Not shown</option>
              {OPERATORS.map((o) => <option key={o}>{o}</option>)}
              {node.operator && !OPERATORS.includes(node.operator) && <option>{node.operator}</option>}
            </select>
          </Row>
          <Text label="Valve tag" value={node.tag} placeholder="e.g. HV-101" onCommit={(tag) => edit((n) => { n.tag = tag.trim() || undefined; })} />
        </>
      )}
      {ECCENTRIC.test(code) && (
        <>
          <Row label="Flat side">
            <select aria-label="Eccentric flat side" value={node.flat ?? ""}
              onChange={(e) => edit((n) => { if (e.target.value) n.flat = e.target.value as "top" | "bottom"; else delete n.flat; })}>
              <option value="">Not stated</option>
              <option value="top">Flat on top (FOT)</option>
              <option value="bottom">Flat on bottom (FOB)</option>
            </select>
          </Row>
          <p className="iso-help">Flat on top keeps vapour out of a pump suction; flat on bottom lets a line drain.</p>
        </>
      )}
      {node.kind === "support" && (
        <label className="iso-check">
          <input type="checkbox" checked={node.dimensioned !== false} onChange={(e) => edit((n) => { n.dimensioned = e.target.checked ? undefined : false; })} />
          Dimension its location
        </label>
      )}
      {node.kind === "annotation" && (
        <label className="iso-check">
          <input type="checkbox" checked={!!node.dimensioned} onChange={(e) => edit((n) => { n.dimensioned = e.target.checked || undefined; })} />
          Dimension its location
        </label>
      )}
      {(node.kind === "support" ? node.dimensioned !== false : node.kind === "annotation" && !!node.dimensioned) && (
        <label className="iso-check">
          <input type="checkbox" checked={!!node.approximate} onChange={(e) => edit((n) => { n.approximate = e.target.checked || undefined; })} />
          Approximate (±)
        </label>
      )}
      {(node.kind === "support" || node.kind === "annotation") && (
        <Text label="Label" value={node.calloutText} placeholder={type?.label.toUpperCase()}
          onCommit={(text) => edit((n) => { n.calloutText = text.trim() || undefined; })} />
      )}
      {node.kind === "flange" && edges.length === 1 && type?.endPrep !== "FL" && (() => {
        const supply = { gasket: true, bolts: true, ...node.jointSupply };
        const set = (change: Partial<NonNullable<PipeNode["jointSupply"]>>) => edit((n) => { n.jointSupply = { ...supply, ...change }; });
        const lap = isLapJoint(code);
        return (
          <>
            <label className="iso-check">
              <input type="checkbox" checked={supply.flange !== false} onChange={(e) => set({ flange: e.target.checked })} />
              {lap ? "Supply the lap-joint flange (the stub end is always listed)" : "Supply the flange"}
            </label>
            <label className="iso-check">
              <input type="checkbox" checked={supply.gasket} onChange={(e) => set({ gasket: e.target.checked })} />
              Supply the gasket for this joint
            </label>
            <label className="iso-check">
              <input type="checkbox" checked={supply.bolts} onChange={(e) => set({ bolts: e.target.checked })} />
              Supply the bolts for this joint
            </label>
            <Row label="Bolts to">
              <select aria-label="Joint mate" value={supply.mate ?? "flange"} onChange={(e) => set({ mate: e.target.value as "flange" | "lug" })}>
                <option value="flange">A flange (stud bolts through both)</option>
                <option value="lug">A lug valve or tapped nozzle (lug bolts)</option>
              </select>
            </Row>
            <Row label="End point">
              <select aria-label="Joint measured to" value={supply.measuredTo ?? "flange"} onChange={(e) => set({ measuredTo: e.target.value as "mate" | "flange" })}>
                <option value="flange">This flange's face</option>
                <option value="mate">The face it bolts to (gasket allowed for)</option>
              </select>
            </Row>
          </>
        );
      })()}
      {type?.endPrep === "FL" && edges.map((run, i) => {
        const choice = node.portFlanges?.[run.id];
        const set = (change: Partial<NonNullable<PipeNode["portFlanges"]>[string]>) =>
          edit((n) => { n.portFlanges = { ...n.portFlanges, [run.id]: { ...n.portFlanges?.[run.id], ...change } }; });
        return (
          <div key={run.id} className="iso-port">
            <Row label={`Flanged end ${i + 1} mates with`}>
              <select aria-label={`Mating flange ${i + 1}`} value={choice?.component ?? ""} onChange={(e) => set({ component: e.target.value || undefined })}>
                <option value="">Specification flange</option>
                {flangeChoices.map((c) => <option key={c} value={c}>{COMPONENT_TYPES.find((t) => t.code === c)?.label ?? c}</option>)}
                <option value="NONE">Not supplied (existing flange)</option>
              </select>
            </Row>
            <label className="iso-check">
              <input type="checkbox" checked={choice?.gasket !== false} onChange={(e) => set({ gasket: e.target.checked })} /> Gasket
            </label>
            <label className="iso-check">
              <input type="checkbox" checked={choice?.bolts !== false} onChange={(e) => set({ bolts: e.target.checked })} /> Bolts
            </label>
          </div>
        );
      })}
      {joints.map((j, i) => (
        <p key={j.id} className="iso-help">
          Joint {joints.length > 1 ? i + 1 : ""}: {j.flanges.map((f) => (isLapJoint(f.code) ? "lap-joint flange + stub end" : COMPONENT_TYPES.find((t) => t.code === f.code)?.label.toLowerCase() ?? f.code)).join(", ") || "existing flange"}
          {j.gasket ? ` · gasket ${draftLength(j.gasket.thickness, "imperial")} thick${j.supplied.gasket ? "" : " (by others)"}` : " · no gasket"}
          {j.bolts ? ` · ${j.bolts.count} ${j.bolts.kind === "lug" ? "lug bolts" : "studs"} ${boltSizeText(j.bolts.diameter, j.bolts.length)}${j.supplied.bolts ? "" : " (by others)"}` : " · no bolts"}
        </p>
      ))}
    </div>
  );
}
