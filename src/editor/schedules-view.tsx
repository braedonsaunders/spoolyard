import { Download } from "lucide-react";
import { COMPONENT_TYPES } from "../core/components";
import { sizeFor, sizeHeader } from "../core/format";
import { connected, round, type IsoDocument, type PipeNode } from "../core/model";
import { UNKNOWN, allowanceText, cutText, lengthUnits, overallText, pieceText, type cutSchedule, type materialSchedule, type weldSchedule } from "../core/schedules";
import { NumberInput, TextInput } from "./inspector/kit";
import { RibbonField } from "./ribbon-field";

const KG_PER_LB = 0.45359237;
/** A material row's weight in the drawing's units. */
export const weightText = (kg: number | undefined, units: IsoDocument["units"]) => (kg == null ? UNKNOWN : String(round(units === "imperial" ? kg / KG_PER_LB : kg)));

/** Materials and pipe cuts: the bill of materials and the cut schedule, each row selecting what it lists. */
export function MaterialsView({ doc, materials, pieces, pendingCuts, missingTakeouts, onSelect, onTakeout, onExport }: {
  doc: IsoDocument;
  materials: ReturnType<typeof materialSchedule>;
  pieces: ReturnType<typeof cutSchedule>;
  pendingCuts: number;
  missingTakeouts: PipeNode[];
  onSelect: (id: string) => void;
  /** Shows the takeout of a component that has none. */
  onTakeout: (nodeId: string) => void;
  onExport: (format: "bom" | "cut") => void;
}) {
  const size = sizeHeader(doc);
  return (
    <div className="iso-schedules">
      <div className="iso-schedule-title">
        <h2>Materials & pipe cuts</h2>
        <button onClick={() => onExport("bom")}><Download size={14} /> Material CSV</button>
        <button onClick={() => onExport("cut")}><Download size={14} /> Cut list CSV</button>
      </div>
      {pendingCuts > 0 && (
        <div className="iso-dimension-review" role="status">
          <strong>Pipe cut lengths are pending</strong>
          <p>Pipe quantities use cut lengths after fitting takeouts and root gaps. Overall centreline lengths are shown in the cut schedule below.</p>
          {missingTakeouts.length ? (
            <>
              <p>Enter a measured takeout for these fittings:</p>
              {missingTakeouts.map((node) => (
                <button key={node.id} onClick={() => onTakeout(node.id)}>
                  {node.description || COMPONENT_TYPES.find((t) => t.code === node.component)?.label || node.kind}
                  {node.tag ? " · " + node.tag : ""} · {connected(doc, node.id)[0]?.spool} · Enter takeout
                </button>
              ))}
            </>
          ) : <p>One or more pipe cuts have no length remaining after fitting takeouts and root gaps. Review their measurements below.</p>}
        </div>
      )}
      <h3>Bill of materials</h3>
      <p>Each sheet's bill of materials, numbered as tagged on that sheet. Pipe quantity is the order length in {lengthUnits(doc.units)}.</p>
      <table>
        <thead>
          <tr>{["Spool", "Item", "Quantity", size, "Description", doc.units === "imperial" ? "Weight (lb)" : "Weight (kg)"].map((s) => <th key={s}>{s}</th>)}</tr>
        </thead>
        <tbody>
          {materials.map((m) => (
            // Joint parts (`<node>[:<pipe>]#part`) select their node.
            <tr key={m.spool + ":" + m.id} onClick={() => onSelect(m.memberIds[0].split("#")[0].split(":")[0])}>
              <td>{m.spool}</td>
              <td>{m.id}</td>
              <td>{m.qtyText}</td>
              <td>{m.nd}</td>
              <td>{m.description}</td>
              <td>{weightText(m.weightKg ?? undefined, doc.units)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Pipe cut schedule</h3>
      <p>
        Lengths in {lengthUnits(doc.units)}. Item is the pipe's number on its sheet; overall runs between the sheet's dimension
        points, and cut = overall − takeouts − root gaps. Ends: BE bevelled, PE plain, TE threaded.
      </p>
      <table>
        <thead>
          <tr>{["Spool", "Item", size, "Overall", "Takeouts", "Root gaps", "Cut", "Ends"].map((s) => <th key={s}>{s}</th>)}</tr>
        </thead>
        <tbody>
          {pieces.map((c) => (
            <tr key={c.run.id + ":" + c.piece} onClick={() => onSelect(c.run.id)}>
              <td>{c.spool}</td>
              <td>{pieceText(c)}</td>
              <td>{sizeFor(doc, c.run.nps)}</td>
              <td>{overallText(c.overall, doc.units)}</td>
              <td>{c.takeouts.map((v) => allowanceText(v, doc.units)).join(" + ")}</td>
              <td>{c.gaps.map((v) => allowanceText(v, doc.units)).join(" + ")}</td>
              <td>{cutText(c, doc.units)}</td>
              <td>{c.ends.join(" / ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The weld map: numbering set once for the drawing, then every weld with its joint. */
export function WeldsView({ doc, joints, commit, onError, onSelect, onExport }: {
  doc: IsoDocument;
  joints: ReturnType<typeof weldSchedule>;
  commit: (edit: (d: IsoDocument) => void) => boolean;
  onError: (message: string) => void;
  onSelect: (id: string) => void;
  onExport: () => void;
}) {
  return (
    <div className="iso-schedules">
      <div className="iso-schedule-title">
        <h2>Weld map</h2>
        <RibbonField label="Prefix">
          <TextInput aria="Weld number prefix" value={doc.weldPrefix} maxLength={20} onError={onError} onCommit={(v) => commit((d) => { d.weldPrefix = v; })} />
        </RibbonField>
        <RibbonField label="First number">
          <NumberInput aria="First weld number" value={doc.weldStart} min={1} max={1e6} integer required onError={onError}
            onCommit={(v) => v != null && commit((d) => { d.weldStart = v; })} />
        </RibbonField>
        <RibbonField label="Numbering">
          <select aria-label="Weld numbering" value={doc.weldNumbering ?? "numeric"} onChange={(e) => commit((d) => { d.weldNumbering = e.target.value as "numeric"; })}>
            <option value="numeric">Numeric</option>
            <option value="alphabetic">Alphabetic</option>
          </select>
        </RibbonField>
        <button onClick={onExport}><Download size={14} /> Weld CSV</button>
      </div>
      <table>
        <thead>
          <tr>{["Weld", "Spool", "Type", "Size", "Schedule", "Joint", "Shop / field"].map((s) => <th key={s}>{s}</th>)}</tr>
        </thead>
        <tbody>
          {joints.map((w) => (
            <tr key={w.weld.runId + ":" + w.weld.tag} onClick={() => onSelect(w.weld.runId)}>
              <td>{w.weld.tag}</td>
              <td>{w.spool}</td>
              <td>{w.type}</td>
              <td>{w.size}</td>
              <td>{w.schedule}</td>
              <td>{w.joint}</td>
              <td>{w.weld.fieldFit ? "Field fit" : w.weld.field ? "Field" : "Shop"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
