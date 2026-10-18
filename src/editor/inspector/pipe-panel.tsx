import type { ReactNode } from "react";
import {
  fieldFitMakeup,
  formatAllowance,
  setFieldFit,
  getNode,
  getSpec,
  prepAt,
  resizeRun,
  resizeRunToCut,
  runResult,
  sub,
  type EndPrep,
  type IsoDocument,
  type PipeRun,
  type Vec3,
} from "../../core/model";
import { directionName, setDimensionAxis, setDimensionReverse, setLineFlow } from "../../core/component-position";
import { sizeFor, sizeHeader } from "../../core/format";
import { routingSizes, type LibrarySpecSummary } from "../library";
import { END_PREPS, SpecSelect, endPrepName } from "../choices";
import { DIRECTIONS } from "../command-line";
import { paperUnits } from "../paper";
import { Group, LengthInput, Metric, Metrics, Note, NumberInput, PairHead, PaperInput, PaperPointInputs, Row, Section, Segmented, Switch, Tabbed, TextInput, Toggle, tri, untri } from "./kit";
import { fitOletToBranch } from "../edit-ops";

type Offset = NonNullable<PipeRun["offsetDrawing"]>;

export interface PipePanelProps {
  doc: IsoDocument;
  run: PipeRun;
  commit: (edit: (d: IsoDocument) => void) => boolean;
  onError: (message: string) => void;
  library: LibrarySpecSummary[] | null;
  libraryError?: string;
  specBusy: string;
  chooseSpec: (value: string, runId: string) => void;
  /** Shared sections appended to the Fabrication tab, such as routing. */
  extra?: ReactNode;
}

/** A pipe: its lengths up front, then what it is and how it ends, then how the sheet draws it. */
export function PipePanel({ doc, run, commit, onError, library, libraryError, specBusy, chooseSpec, extra }: PipePanelProps) {
  const paper = paperUnits(doc);
  const edit = (change: (r: PipeRun, d: IsoDocument) => void) => commit((d) => change(d.runs.find((r) => r.id === run.id)!, d));
  const offset = (change: (o: Offset, r: PipeRun) => void) => edit((r) => change((r.offsetDrawing ??= {}), r));
  const result = runResult(doc, run), o = run.offsetDrawing ?? {};
  const along = sub(getNode(doc, run.to).position, getNode(doc, run.from).position);
  const isOffset = along.filter((v) => Math.abs(v) > 0.01).length > 1;
  const spec = getSpec(doc, run.specId);
  const ends = ([0, 1] as const).map((i) => ({ i, name: i ? "End" : "Start", prep: prepAt(run, i), field: !!run[i ? "toField" : "fromField"], tag: run[i ? "toTag" : "fromTag"] }));
  // Offset drafting sizes are distances on the printed sheet, shown in paper units; the hatch count is a count.
  const offsetNumber = (key: "rightAngleSize" | "angleRadiusH" | "angleRadiusV" | "hatchCount" | "hatchSpacing" | "hatchStart" | "hatchGap", label: string, max: number, short: string) => (
    <Row label={short} keywords={"offset " + label} modified={o[key] != null} onReset={() => offset((x) => { x[key] = undefined; })}>
      {key === "hatchCount"
        ? <NumberInput aria={label} min={0} max={max} integer placeholder="Automatic" value={o[key]} onError={onError} onCommit={(v) => offset((x) => { x[key] = v; })} />
        : <PaperInput aria={label} sheet={o[key]} paper={paper} min={0} max={max} allowEmpty onError={onError} onCommit={(v) => offset((x) => { x[key] = v; })} />}
    </Row>
  );
  const corner = (plane: "H" | "V") => {
    const key = plane === "H" ? "angleFromH" : "angleFromV", name = plane === "H" ? "Horizontal" : "Vertical";
    return (
      <Row label={`${name} corner`} keywords={`offset ${name} angle corner`} group>
        <Segmented aria={`${name} angle corner`} value={o[key] ?? "start"} onChange={(v) => offset((x) => { x[key] = v; })}
          choices={[{ value: "start", label: "Start" }, { value: "end", label: "End" }]} />
      </Row>
    );
  };

  const fabrication = (
    <>
      <Section id="pipe.pipe" title="Pipe" defaultOpen summary={`${sizeFor(doc, run.nps)} · ${spec.name}`}>
        <Row label="Specification">
          <SpecSelect doc={doc} aria="Pipe specification" value={run.specId} library={library} libraryError={libraryError} busy={specBusy} onChange={(v) => void chooseSpec(v, run.id)} />
        </Row>
        <Row label={sizeHeader(doc)} keywords="nps dn nominal size diameter">
          <select aria-label="Pipe nominal size" value={run.nps} onChange={(e) => edit((r, d) => { r.nps = Number(e.target.value); fitOletToBranch(d, r.from); fitOletToBranch(d, r.to); })}>
            {(() => {
              // A specification with no size table (read from a PCF) offers the sizes its pipes are drawn at.
              const { sizes, listed } = routingSizes(doc, spec);
              return [...new Set([...sizes, run.nps])].sort((a, b) => a - b).map((v) => (
                <option key={v} value={v}>{sizeFor(doc, v)}{listed && spec.sizes.some((s) => s.nps === v) ? "" : " (not in spec)"}</option>
              ));
            })()}
          </select>
        </Row>
        {!run.connector && (
          <>
            <Row label="Material text" keywords="bill of materials bom description" modified={!!run.description} onReset={() => edit((r) => { delete r.description; })}>
              <TextInput aria="Pipe BOM description" value={run.description} placeholder="As the specification" maxLength={300}
                onCommit={(v) => edit((r) => { v = v.trim(); if (v) r.description = v.slice(0, 300); else delete r.description; })} />
            </Row>
            <Toggle label="List by length, no cut" keywords="uncut drawing break bom" hint="The pipe runs on through a drawing break."
              checked={!!run.uncut} onChange={(on) => edit((r) => { if (on) r.uncut = true; else delete r.uncut; })} />
          </>
        )}
      </Section>

      <Section id="pipe.ends" title="Ends & welds" defaultOpen summary={ends.map((e) => e.prep + (e.field ? " FW" : "")).join(" → ")}>
        <PairHead columns={["Start", "End"]} />
        <Row label="Preparation" keywords="end prep weld start" pair>
          {ends.map((end) => (
            <select key={end.i} aria-label={`${end.name} preparation`} title={endPrepName(end.prep)} value={end.prep}
              onChange={(e) => edit((r) => { r[end.i ? "toPrep" : "fromPrep"] = e.target.value as EndPrep; })}>
              {END_PREPS.map((p) => <option key={p.value} value={p.value} title={p.label}>{p.value}</option>)}
            </select>
          ))}
        </Row>
        <Row label="Field weld" keywords="fw site start end" pair>
          {ends.map((end) => (
            <Switch key={end.i} aria={`${end.name} field weld`} checked={end.field} onChange={(on) => edit((r) => { r[end.i ? "toField" : "fromField"] = on; })} />
          ))}
        </Row>
        <Row label="Field fit" keywords="ffw field fit makeup trim site" hint={`Cut long by ${formatAllowance(fieldFitMakeup(doc), doc.units)} and trimmed to fit on site. The makeup is set under Drawing setup › Project profile.`} pair>
          {ends.map((end) => (
            <Switch key={end.i} aria={`${end.name} field fit`} checked={!!run[end.i ? "toFieldFit" : "fromFieldFit"]}
              onChange={(on) => commit((d) => setFieldFit(d, run.id, end.i ? "to" : "from", on))} />
          ))}
        </Row>
        <Row label="Weld tag" keywords="weld number start end" pair>
          {ends.map((end) => (
            <TextInput key={end.i} aria={`${end.name} weld tag`} value={end.tag} placeholder="Auto"
              onCommit={(v) => edit((r) => { r[end.i ? "toTag" : "fromTag"] = v; })} />
          ))}
        </Row>
        <Row label="Root gap" keywords="override weld gap" modified={run.rootGap != null} onReset={() => edit((r) => { r.rootGap = undefined; })}>
          <LengthInput aria="Root gap override" mm={run.rootGap} units={doc.units} precision="fine" allowEmpty onError={onError}
            onCommit={(v) => edit((r) => { r.rootGap = v; })} />
        </Row>
      </Section>

      <Section id="pipe.identity" title="Identification" summary={[run.spool, run.line].filter(Boolean).join(" · ")}>
        {(["spool", "line", "heat"] as const).map((k) => (
          <Row key={k} label={k === "spool" ? "Spool" : k === "line" ? "Line number" : "Heat number"} keywords={k}>
            <TextInput aria={`Pipe ${k}`} value={run[k]} onCommit={(v) => edit((r) => { r[k] = v; })} />
          </Row>
        ))}
      </Section>
      {extra}
    </>
  );

  const annotation = run.connector ? (
    <Note>A connector is drawn by the components it joins; it has no flow, dimensions or labels of its own.</Note>
  ) : (
    <>
      <Section id="pipe.flow" title="Flow" defaultOpen summary={run.flow ? "Flows " + directionName(run.flow === "reverse" ? (along.map((v) => -v) as Vec3) : along) : "Not set"}>
        <Row label="Direction" keywords="flow arrow">
          <select aria-label="Flow direction" value={run.flow ?? ""} onChange={(e) => commit((d) => setLineFlow(d, run.id, (e.target.value || undefined) as PipeRun["flow"]))}>
            <option value="">Not set</option>
            <option value="forward">Flows {directionName(along)}</option>
            <option value="reverse">Flows {directionName(along.map((v) => -v) as Vec3)}</option>
          </select>
        </Row>
        {run.flow && (
          <>
            <Toggle label="Show flow arrow" keywords="flow" checked={run.showFlow !== false}
              onChange={(on) => edit((r) => { r.showFlow = on ? undefined : false; })} />
            <Row label="Arrow position" keywords="flow arrow percent along" modified={run.flowPosition != null} onReset={() => edit((r) => { r.flowPosition = undefined; })}>
              <NumberInput aria="Flow arrow position" min={0} max={100} suffix="%" placeholder="Automatic" onError={onError}
                value={run.flowPosition == null ? undefined : Math.round(run.flowPosition * 10000) / 100}
                onCommit={(v) => edit((r) => { r.flowPosition = v == null ? undefined : v / 100; })} />
            </Row>
          </>
        )}
      </Section>

      <Section id="pipe.labels" title="Labels" defaultOpen>
        <Row label="Size label" keywords="size label ns nps dn nominal" group>
          <Segmented aria="Show pipe nominal size" value={tri(run.showSize)} onChange={(v) => edit((r) => { r.showSize = untri(v); })}
            choices={[{ value: "", label: "Auto" }, { value: "true", label: "Show", title: "Show on this pipe" }, { value: "false", label: "Hide" }]} />
        </Row>
        <Row label="Line number" keywords="line number placement" group>
          <Segmented aria="Line number placement" value={tri(run.showLineNumber)}
            onChange={(v) => edit((r, d) => {
              if (v === "true") for (const x of d.runs) if (x.line === run.line && x.spool === run.spool) delete x.showLineNumber;
              r.showLineNumber = untri(v);
            })}
            choices={[{ value: "", label: "Auto" }, { value: "true", label: "Here", title: "On this pipe" }, { value: "false", label: "Hide", title: "Hide on this pipe" }]} />
        </Row>
        <Row label="Line no. lettering" keywords="line number plane">
          <select aria-label="Line number lettering plane" value={run.lineNumberPlane ?? ""}
            onChange={(e) => edit((_, d) => { for (const x of d.runs) if (x.line === run.line && x.spool === run.spool) x.lineNumberPlane = (e.target.value || undefined) as PipeRun["lineNumberPlane"]; })}>
            <option value="">Automatic</option>
            <option value="vertical">Vertical plane</option>
            <option value="plan">Plan plane</option>
            <option value="normal">Normal to pipe</option>
            <option value="alternate">Other isometric plane</option>
          </select>
        </Row>
      </Section>

      <Section id="pipe.dimensions" title="Dimensions" defaultOpen>
        <Row label="Extensions" keywords="dimension extension direction side"
          hint="Set along the line through its fittings and tee runs; each branch is set on its own.">
          <select aria-label="Dimension extension direction" value={run.dimensionAxis?.join(",") ?? ""}
            onChange={(e) => commit((d) => setDimensionAxis(d, run.id, e.target.value ? (e.target.value.split(",").map(Number) as Vec3) : undefined))}>
            <option value="">Automatic</option>
            {DIRECTIONS.map((d) => <option key={d.name} value={d.vector.join(",")}>{d.name}</option>)}
          </select>
        </Row>
        <Toggle label="Flip dimension lettering" keywords="reverse text" checked={!!run.dimensionReverse}
          onChange={(on) => commit((d) => setDimensionReverse(d, run.id, on))} />
      </Section>

      {isOffset && (
        <Section id="pipe.offset" title="Offset drafting" summary="Triangle, angles and hatch">
          <Group title="Show">
            <Toggle label="True length dimension" aria="Dimension the true length" keywords="offset" checked={o.showTrueLength !== false} onChange={(on) => offset((x) => { x.showTrueLength = on; })} />
            <Toggle label="Triangle leg values" aria="Show triangle leg values" keywords="offset" checked={o.showLegValues !== false} onChange={(on) => offset((x) => { x.showLegValues = on; })} />
            <Toggle label="Dimension triangle legs" aria="Dimension the triangle legs" keywords="offset" checked={!!o.dimensionLegs} onChange={(on) => offset((x) => { x.dimensionLegs = on; })} />
            <Toggle label="Set and roll" aria="Show set and roll" keywords="offset" checked={!!o.setAndRoll} onChange={(on) => offset((x) => { x.setAndRoll = on; })} />
            <Toggle label="Angle arrows" aria="Angular dimension arrows" keywords="offset angular" checked={!!o.angleArrows} onChange={(on) => offset((x) => { x.angleArrows = on; })} />
            <Toggle label="Horizontal arrows outward" aria="Horizontal angle arrows outward" keywords="offset angle" checked={!!o.angleOutwardH} onChange={(on) => offset((x) => { x.angleOutwardH = on; })} />
            <Toggle label="Vertical arrows outward" aria="Vertical angle arrows outward" keywords="offset angle" checked={!!o.angleOutwardV} onChange={(on) => offset((x) => { x.angleOutwardV = on; })} />
          </Group>
          <Group title="Angles">
            {corner("H")}
            {corner("V")}
            {offsetNumber("angleRadiusH", "Horizontal angle radius", 5000, "Horizontal radius")}
            {offsetNumber("angleRadiusV", "Vertical angle radius", 5000, "Vertical radius")}
            {offsetNumber("rightAngleSize", "Right angle marker size", 5000, "Right-angle mark")}
          </Group>
          <Group title="Hatch">
            <Row label="Corner" keywords="offset hatch corner" group>
              <Segmented aria="Offset hatch corner" value={o.hatchFrom ?? "start"} onChange={(v) => offset((x) => { x.hatchFrom = v; })}
                choices={[{ value: "start", label: "Start" }, { value: "end", label: "End" }]} />
            </Row>
            <Row label="Plane" keywords="offset hatch plane" group>
              <Segmented aria="Offset hatch plane" value={o.hatchPlane ?? ""} onChange={(v) => offset((x) => { x.hatchPlane = (v || undefined) as Offset["hatchPlane"]; })}
                choices={[{ value: "", label: "Both" }, { value: "H", label: "Horiz." , title: "Horizontal" }, { value: "V", label: "Vert.", title: "Vertical" }]} />
            </Row>
            {offsetNumber("hatchCount", "Hatch lines", 200, "Lines")}
            {offsetNumber("hatchSpacing", "Hatch spacing", 5000, "Spacing")}
            {offsetNumber("hatchStart", "Hatch start distance", 5000, "Start distance")}
            {offsetNumber("hatchGap", "Hatch gap at pipe", 5000, "Gap at pipe")}
          </Group>
          <Group title="Layout">
            <Row label="Triangle lettering" keywords="offset leg plane" group>
              <Segmented aria="Offset triangle lettering plane" value={o.legPlane ?? "construction"} onChange={(v) => offset((x) => { x.legPlane = v; })}
                choices={[{ value: "construction", label: "Construction", title: "Construction plane" }, { value: "vertical", label: "Vertical" }]} />
            </Row>
            {o.planPoint ? (
              <Row label="Plan point on paper" keywords="offset plan point x y" hint="From the sheet's lower-left corner" pair modified onReset={() => offset((x) => { x.planPoint = undefined; })}>
                <PaperPointInputs point={o.planPoint} paper={paper} aria="Offset plan point" onError={onError} onCommit={(p) => offset((x) => { x.planPoint = p; })} />
              </Row>
            ) : (
              <Row label="Plan point on paper" keywords="offset plan point">
                <span className="insp-value">Automatic</span>
              </Row>
            )}
            <Row label="True length spacing" keywords="offset" modified={o.trueLengthOffset != null} onReset={() => offset((x) => { x.trueLengthOffset = undefined; })}>
              <PaperInput aria="Offset true length spacing" sheet={o.trueLengthOffset} paper={paper} min={-5000} max={5000} allowEmpty onError={onError}
                onCommit={(v) => offset((x) => { x.trueLengthOffset = v; })} />
            </Row>
          </Group>
        </Section>
      )}
    </>
  );

  return (
    <>
      {!run.connector && (
        <Metrics>
          <Metric unit={doc.units === "mm" ? "mm" : undefined} label="Overall" hint="Centreline length, end to end">
            <LengthInput aria="Pipe overall length" mm={result.overall} units={doc.units} onError={onError}
              onCommit={(v) => { if (v != null && Math.abs(v - result.overall) > 0.001) return commit((d) => resizeRun(d, run.id, v)); }} />
          </Metric>
          <Metric unit={doc.units === "mm" ? "mm" : undefined} label="Pipe cut" hint="Overall less fitting takeouts and root gaps">
            <LengthInput aria="Pipe cut length" mm={Number.isFinite(result.cut) ? result.cut : undefined} units={doc.units} placeholder="Pending" onError={onError}
              onCommit={(v) => { if (v != null) return commit((d) => resizeRunToCut(d, run.id, v)); }} />
          </Metric>
        </Metrics>
      )}
      <Tabbed fabrication={fabrication} annotation={annotation} />
    </>
  );
}
