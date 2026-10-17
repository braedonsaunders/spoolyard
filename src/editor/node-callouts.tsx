import { COMPONENT_TYPE_BY_CODE, COMPONENT_TYPES } from "../core/components";
import { useRef, useState } from "react";
import { drawingReference } from "../core/references";
import { flangedJoints, isLapJoint, nodeCode, nodeItem } from "../core/joints";
import { boltSizeText, draftLength } from "../core/format";
import { sheetMaterials } from "../core/material-list";
import { connected, formatAllowance, getNode, getSpec, parseIsoJson, type IsoDocument, type FlatSide, type PipeNode } from "../core/model";

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
export function NodeCallouts({ doc, nodeId, commit, sheetPoint }: { doc: IsoDocument; nodeId: string; commit: (edit: (d: IsoDocument) => void) => unknown; sheetPoint?: [number, number] }) {
  const referenceInput = useRef<HTMLInputElement>(null);
  const [referenceError, setReferenceError] = useState("");
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const edges = connected(doc, node.id), code = nodeCode(doc, node) ?? "";
  const paperRun = edges[0] ?? doc.runs.find(r => r.id === node.associatedRunId);
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
      <Row label="Nominal size"><select aria-label="Fitting size label" value={node.showSize==null?'':String(node.showSize)} onChange={e=>edit(n=>{n.showSize=e.target.value===''?undefined:e.target.value==='true'})}><option value="">Automatic</option><option value="true">Prefer this fitting</option><option value="false">Hide size</option></select></Row>
      {edges.some(r=>r.nps!==edges[0]?.nps)&&<Row label="Size format"><select aria-label="Nominal size format" value={node.sizeLabelFormat??'standard'} onChange={e=>edit(n=>{n.sizeLabelFormat=e.target.value as 'standard'|'compact'})}><option value="standard">Standard</option><option value="compact">Compact</option></select></Row>}
      {node.kind === "tee" && <Row label="Branch dimension tier">
        <select aria-label="Branch dimension tier" value={node.dimensionChain ?? "both"} onChange={e => edit(n => { n.dimensionChain = e.target.value as "both" | "body" | "mate"; })}>
          <option value="both">Both chains</option>
          <option value="body">Component body-face chain</option>
          <option value="mate">Mating flange-face chain</option>
        </select>
      </Row>}
      {sheetPoint && paperRun && <details>
        <summary>Isometric paper position</summary>
        <p className="iso-help">Arrange the drawing without changing plant coordinates or cut lengths.</p>
        {([0, 1] as const).map(axis => <Text key={axis} label={axis ? "Sheet Y" : "Sheet X"} value={String(Math.round(sheetPoint[axis] * 10) / 10)}
          onCommit={value => {
            const at = Number(value);
            if (!Number.isFinite(at) || Math.abs(at) > 10000) return;
            commit(d => {
              const spool = paperRun.spool; d.sheets ??= {}; d.sheets[spool] ??= {};
              const pins = (d.sheets[spool].nodePositions ??= {}), point: [number, number] = [...sheetPoint];
              point[axis] = at; pins[nodeId] = point;
            });
          }} />)}
        <button onClick={() => commit(d => { const pins = d.sheets?.[paperRun.spool]?.nodePositions; if (pins) delete pins[nodeId]; })}>Use automatic position</button>
      </details>}
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
              <details><summary>Continuation route on paper</summary>
                <Text label="Route points (x, y; x, y)" value={node.continuation.paperPath?.map(p=>p.join(', ')).join('; ')??''} onCommit={value=>{
                  const points=value.trim()?value.split(';').map(p=>p.split(',').map(Number)):undefined;
                  if(points&&(points.length<2||points.some(p=>p.length!==2||!p.every(Number.isFinite))))return;
                  edit(n=>{n.continuation={...n.continuation!,paperPath:points as [number,number][]|undefined}})
                }}/>
                <Row label="Note points to"><select aria-label="Continuation note target" value={node.continuation.leaderAt??'end'} onChange={e=>edit(n=>{n.continuation={...n.continuation!,leaderAt:e.target.value as 'node'|'end'}})}><option value="end">Route end</option><option value="node">Model endpoint</option></select></Row>
                <Row label="Route end"><select aria-label="Continuation route end" value={node.continuation.endMarker??'plain'} onChange={e=>edit(n=>{n.continuation={...n.continuation!,endMarker:e.target.value as 'plain'|'break'|'tube'}})}><option value="plain">Plain</option><option value="break">Break</option><option value="tube">Tube end</option></select></Row>
              </details>
              <label className="iso-check">
                <input type="checkbox" checked={node.continuation.coordinates !== false}
                  onChange={(e) => edit((n) => { n.continuation = { ...n.continuation!, coordinates: e.target.checked }; })} />
                Show plant coordinates (E/N/EL)
              </label>
              {node.kind === "flange" && type?.endPrep !== "FL" && (
                <Row label="Coordinate at">
                  <select aria-label="Continuation coordinate face" value={node.continuation.coordinateFace ?? ""}
                    onChange={(e) => edit((n) => { n.continuation = { ...n.continuation!, coordinateFace: e.target.value as "flange" | "mate" || undefined }; })}>
                    <option value="">The dimension end point</option>
                    <option value="flange">This flange's face</option>
                    <option value="mate">The mating face across the gasket</option>
                  </select>
                </Row>
              )}
            </>
          )}
          <Row label="Adjacent drawing">
            <button onClick={() => referenceInput.current?.click()}>Link a .piping drawing…</button>
          </Row>
          <input ref={referenceInput} type="file" accept=".piping,.json" hidden onChange={async (e) => {
            const file = e.target.files?.[0]; e.target.value = "";
            if (!file) return;
            try {
              const source = parseIsoJson(await file.text());
              const reference = drawingReference(doc, nodeId, source);
              commit(d => { d.references = [...(d.references ?? []).filter(r => r.atNodeId !== nodeId), reference]; });
              setReferenceError("");
            } catch (error) { setReferenceError(error instanceof Error ? error.message : "Could not open the adjacent drawing."); }
          }} />
          {referenceError && <p role="alert" className="iso-help">{referenceError}</p>}
          {(doc.references ?? []).filter(r => r.atNodeId === nodeId).map(r => (
            <div key={r.id}>
              <p className="iso-help">{r.name} · excluded from material and weld quantities.</p>
              <Row label="Context parts">
                <select aria-label="Adjacent components shown" value={r.components ?? 1} onChange={e => commit(d => {
                  d.references!.find(x => x.id === r.id)!.components = Number(e.target.value);
                })}><option value={0}>Pipe only</option>{[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}</select>
              </Row>
              <Row label="Context weight"><select aria-label="Adjacent pipe weight" value={r.pipeWeight?'pipe':'fine'} onChange={e=>commit(d=>{d.references!.find(x=>x.id===r.id)!.pipeWeight=e.target.value==='pipe'})}><option value="fine">Fine</option><option value="pipe">Pipe</option></select></Row>
              <label className="iso-check"><input type="checkbox" aria-label="Show adjacent line number" checked={r.runs.some(run=>run.showLineNumber===true)} onChange={e=>commit(d=>{for(const run of d.references!.find(x=>x.id===r.id)!.runs)run.showLineNumber=e.target.checked?true:undefined})}/> Show adjacent line number</label>
              <Row label="Context end">
                <select aria-label="Adjacent drawing end" value={r.termination ?? 'break'} onChange={e => commit(d => {
                  d.references!.find(x=>x.id===r.id)!.termination=e.target.value as 'break'|'plain';
                })}>
                  <option value="break">Break symbol</option>
                  <option value="plain">Plain line</option>
                </select>
              </Row>
              <Row label="Dimension to">
                <select aria-label="Adjacent dimension point" value={r.dimensionTo ?? ""} onChange={e => commit(d => {
                  d.references!.find(x => x.id === r.id)!.dimensionTo = e.target.value || undefined;
                })}>
                  <option value="">No dimension into the adjacent drawing</option>
                  {r.nodes.filter(n => n.id !== r.anchorNodeId && !["end", "weld", "annotation", "support"].includes(n.kind)).map((n, i) =>
                    <option key={n.id} value={n.id}>{n.tag || COMPONENT_TYPE_BY_CODE[n.component ?? ""]?.label || n.kind} {i + 1}</option>)}
                </select>
              </Row>
              <button onClick={() => commit(d => { d.references = d.references?.filter(x => x.id !== r.id); })}>Remove adjacent drawing</button>
            </div>
          ))}
        </>
      )}
      <Row label="Centreline elevation (℄ EL)">
        <select aria-label="Elevation callout" value={node.elevationCallout == null ? 'auto' : node.elevationCallout ? 'show' : 'hide'} onChange={e => edit(n => { n.elevationCallout = e.target.value === 'auto' ? undefined : e.target.value === 'show'; })}>
          <option value="auto">Automatic</option><option value="show">Show</option><option value="hide">Hide</option>
        </select>
      </Row>
      <Text label="Tie point" value={node.tiePoint?.id} placeholder="e.g. TP-3"
        onCommit={(id) => edit((n) => { n.tiePoint = id.trim() ? { ...n.tiePoint, id: id.trim() } : undefined; })} />
      {node.tiePoint && (
        <Text label="Tie point note" value={node.tiePoint.label} placeholder="e.g. EXIST. FLANGE, FIELD WELD"
          onCommit={(label) => edit((n) => { n.tiePoint = { ...n.tiePoint!, label: label.trim() || undefined }; })} />
      )}
      {/^ISA/.test(code) && <label className="iso-check">
        <input type="checkbox" checked={node.calloutPlane==='pipe'} onChange={e=>edit(n=>{n.calloutPlane=e.target.checked?'pipe':undefined;})} />
        Draw instrument bubble in the pipe plane
      </label>}
      {node.kind === 'support' && node.associatedRunId && <label className="iso-check">
        <input type="checkbox" checked={node.calloutPlane === 'pipe'} onChange={e => edit(n => { n.calloutPlane=e.target.checked?'pipe':undefined; })} />
        Align support lettering with pipe
      </label>}
      {['valve','flange','reducer','cap'].includes(node.kind) && <Row label="Symbol plane">
        <select aria-label="Fitting symbol plane" value={node.symbolPlane ?? ''}
          onChange={e=>edit(n=>{n.symbolPlane=(e.target.value||undefined) as PipeNode['symbolPlane'];})}>
          <option value="">Automatic</option><option value="plan">Plan</option><option value="vertical">Vertical</option><option value="alternate">Other isometric plane</option>
        </select>
      </Row>}
      {/^HOSE/.test(code) && <Text label="Hose route (x, y; x, y)" value={node.hosePath?.map(p=>p.join(', ')).join('; ')??''} onCommit={value=>{
        const points=value.trim()?value.split(';').map(row=>row.split(',').map(Number)):undefined
        if(points && (points.length<2||points.length>500||points.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)))))return
        edit(n=>{n.hosePath=points as [number,number][]|undefined})
      }}/>}
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
          {/^BFLY/.test(code) && <Row label="Butterfly symbol">
            <select aria-label="Butterfly valve symbol" value={node.valveSymbol ?? ''}
              onChange={e => edit(n => { n.valveSymbol = (e.target.value || undefined) as PipeNode['valveSymbol']; })}>
              <option value="">Automatic</option>
              <option value="disc">Disc and lever</option>
              <option value="bowtie">Bow-tie</option>
            </select>
          </Row>}
          {/^CHECK/.test(code) && <Row label="Check symbol">
            <select aria-label="Check valve symbol" value={node.valveSymbol ?? ''}
              onChange={e => edit(n => { n.valveSymbol = (e.target.value || undefined) as PipeNode['valveSymbol']; })}>
              <option value="">Automatic</option>
              <option value="swing">Swing</option>
              <option value="triangle">Triangle</option>
            </select>
          </Row>}
          <Row label="Operator symbol">
            <select aria-label="Valve operator symbol" value={node.valveOperator ?? ''}
              onChange={e => edit(n => { n.valveOperator = (e.target.value || undefined) as PipeNode['valveOperator']; })}>
              <option value="">Automatic</option>
              <option value="none">None</option>
              <option value="lever">Lever</option>
              <option value="actuator">Actuator</option>
              <option value="handwheel">Handwheel</option>
              <option value="box">Box actuator</option>
            </select>
          </Row>
          <Row label="Callout order">
            <select aria-label="Valve callout order" value={node.calloutOrder ?? 'item-first'} onChange={e => edit(n => { n.calloutOrder = e.target.value as 'item-first' | 'tag-first'; })}>
              <option value="item-first">Item, operator, tag</option>
              <option value="item-tag-first">Item, tag, operator</option>
              <option value="tag-first">Tag, operator, item</option>
            </select>
          </Row>
        </>
      )}
      {ECCENTRIC.test(code) && (
        <>
          <Row label="Flat side">
            <select aria-label="Eccentric flat side" value={node.flatSide ?? ""}
              onChange={(e) => edit((n) => { if (e.target.value) n.flatSide = e.target.value as FlatSide; else delete n.flatSide; })}>
              <option value="">Not stated</option>
              <option value="top">Flat on top (FOT)</option>
              <option value="bottom">Flat on bottom (FOB)</option>
              {(["north", "south", "east", "west"] as const).map((side) => <option key={side} value={side}>Flat to the {side} (on a riser)</option>)}
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
      {/INS-LIM/.test(code)&&<Row label="Limit lettering"><select aria-label="Insulation limit lettering" value={node.calloutPlane??''} onChange={e=>edit(n=>{n.calloutPlane=(e.target.value||undefined) as PipeNode['calloutPlane']})}><option value="">Along pipe</option><option value="sheet">Upright on sheet</option><option value="pipe">Pipe plane</option></select></Row>}
      {code==='EQUIP' && <Row label="Equipment outline">
        <select aria-label="Equipment outline shape" value={node.equipmentShape ?? ''}
          onChange={e=>edit(n=>{n.equipmentShape=(e.target.value || undefined) as PipeNode['equipmentShape'];})}>
          <option value="">Generic casing</option><option value="vessel">Vessel on a skid</option><option value="pump">Pump end view</option>
        </select>
      </Row>}
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
            <Row label="Bolting makeup">
              <select aria-label={`Bolting makeup ${i + 1}`} value={choice?.mate ?? "flange"} onChange={e => set({ mate: e.target.value as "flange" | "lug" })}>
                <option value="flange">Through studs</option>
                <option value="lug">Lug bolts into a tapped body</option>
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
      {joints.map((j,i)=> <details key={`items:${j.id}`}>
        <summary>Joint {joints.length>1?i+1:''} item callout</summary>
        <p className="iso-help">Reference an existing material item on this sheet. Supply quantities stay as set above.</p>
        {(['flange','bolts','gasket'] as const).map(part=><Row key={part} label={`${part[0].toUpperCase()+part.slice(1)} item`}>
          <select aria-label={`Joint ${i+1} ${part} item`} value={doc.sheets?.[j.spool]?.jointItems?.[j.id]?.[part] ?? ''}
            onChange={e=>commit(d=>{
              const info=((d.sheets ??= {})[j.spool] ??= {}), held=((info.jointItems ??= {})[j.id] ??= {});
              if(e.target.value)held[part]=e.target.value;else delete held[part];
            })}>
            <option value="">Automatic</option>
            {sheetMaterials(doc,j.spool).filter(r=>r.category===(part==='bolts'?'bolt':part)).map(r=><option key={r.key} value={r.key}>{r.id} · {r.nd} · {r.description}</option>)}
          </select>
        </Row>)}
      </details>)}
    </div>
  );
}
