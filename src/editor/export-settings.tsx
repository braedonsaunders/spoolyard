import { useState } from "react";
import { LAYER_WEIGHT } from "../core/drawing";
import { DXF_DEFAULT_LAYER, DXF_LAYER_PREFIX, type DxfLayerStyle, type DxfLinetype, type DxfOptions } from "../core/document";
import { Group, Note, NumberInput, Row, Section, Segmented, TextInput, Toggle } from "./inspector/kit";

/**
 * How CAD files are written: a company's layer names and pen table, whether the piping model rides along so
 * Spoolyard can reopen the file, and sheet or true-size model space. A preference of the drafter's (or their office),
 * kept in this browser like a plot style table, not in the drawing.
 */
export interface ExportPreferences {
  layerPrefix?: string;
  layers?: Record<string, Partial<DxfLayerStyle>>;
  snapshot?: boolean;
  wipeouts?: boolean;
  /** Symbols, the title block and the material list as block references; off writes plain entities. */
  blocks?: boolean;
  space?: "sheet" | "model";
  /** A PCF is written with its .piping sidecar, zipped, so the round trip keeps what PCF cannot carry. */
  pcfSidecar?: boolean;
}
const KEY = "spoolyard.export";
export function readExportPreferences(): ExportPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
export function storeExportPreferences(p: ExportPreferences) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: this session keeps them */ }
}
/** The options the DXF and DWG writers take. */
export const dxfOptions = (p: ExportPreferences): DxfOptions => ({ layerPrefix: p.layerPrefix, layers: p.layers, snapshot: p.snapshot, wipeouts: p.wipeouts, blocks: p.blocks, space: p.space });

const LINETYPES: DxfLinetype[] = ["CONTINUOUS", "DASHED", "HIDDEN", "CENTER", "PHANTOM"];
/** AutoCAD colour index range. */
const ACI_MAX = 255;

export function ExportSettings({ onError }: { onError: (message: string) => void }) {
  const [prefs, setPrefs] = useState(readExportPreferences);
  const set = (patch: Partial<ExportPreferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    storeExportPreferences(next);
  };
  const setLayer = (layer: string, patch: Partial<DxfLayerStyle>) => {
    const own = { ...prefs.layers?.[layer], ...patch };
    for (const k of Object.keys(own) as Array<keyof DxfLayerStyle>) if (own[k] == null) delete own[k];
    const layers = { ...prefs.layers, [layer]: own };
    if (!Object.keys(own).length) delete layers[layer];
    set({ layers: Object.keys(layers).length ? layers : undefined });
  };
  const layerNames = Object.keys(LAYER_WEIGHT);
  return (
    <Section id="sheet.export" title="CAD export" summary={prefs.space === "model" ? "Model space" : "Sheets"}>
      <Note keywords="dxf dwg export layers pens">How DXF and DWG files are written. Your preference in this browser, used for every drawing.</Note>
      <Row label="Drawn in" keywords="dxf model space paper sheet" group>
        <Segmented aria="DXF space" value={prefs.space ?? "sheet"} onChange={(space) => set({ space: space === "sheet" ? undefined : space })}
          choices={[{ value: "sheet", label: "Sheets", title: "Each sheet 1:1 on its paper, as the PDF" }, { value: "model", label: "Model space", title: "The piping at true size: 1 unit = 1 mm or 1 inch of plant" }]} />
      </Row>
      <Row label="Layer prefix" keywords="layer name standard">
        <TextInput aria="DXF layer prefix" value={prefs.layerPrefix ?? ""} placeholder={DXF_LAYER_PREFIX} maxLength={40} onError={onError}
          onCommit={(v) => { if (/[<>/\\":;?*|=`]/.test(v)) { onError("Layer names cannot contain < > / \\ \" : ; ? * | = or `."); return false; } set({ layerPrefix: v || undefined }); }} />
      </Row>
      <Toggle label="Keep the piping model in the file" hint="Spoolyard reopens the DXF as an editable drawing" checked={prefs.snapshot !== false} onChange={(on) => set({ snapshot: on ? undefined : false })} />
      <Toggle label="White masks as wipeouts" checked={prefs.wipeouts !== false} onChange={(on) => set({ wipeouts: on ? undefined : false })} />
      <Toggle label="Symbols as blocks" hint="Off writes every symbol, the title block and the material list as plain lines and text, for CAD tools that do not read blocks"
        checked={prefs.blocks !== false} onChange={(on) => set({ blocks: on ? undefined : false })} />
      <Toggle label="PCF with its .piping sidecar (ZIP)" hint="Keeps what PCF cannot carry for the round trip" checked={!!prefs.pcfSidecar} onChange={(on) => set({ pcfSidecar: on || undefined })} />
      <Group title="Pen table">
        {layerNames.map((layer) => {
          const own = prefs.layers?.[layer] ?? {};
          return (
            <div key={layer} className="iso-pen-row">
              <Row label={(prefs.layerPrefix ?? DXF_LAYER_PREFIX) + layer} keywords="pen layer colour linetype lineweight" modified={!!prefs.layers?.[layer]}
                onReset={() => set({ layers: Object.fromEntries(Object.entries(prefs.layers ?? {}).filter(([k]) => k !== layer)) })}>
                <NumberInput aria={`${layer} colour (ACI)`} value={own.color} placeholder={String(DXF_DEFAULT_LAYER.color)} min={1} max={ACI_MAX} integer onError={onError}
                  onCommit={(v) => setLayer(layer, { color: v })} />
                <select aria-label={`${layer} linetype`} value={own.linetype ?? ""} onChange={(e) => setLayer(layer, { linetype: (e.target.value || undefined) as DxfLinetype | undefined })}>
                  <option value="">{DXF_DEFAULT_LAYER.linetype.toLowerCase()}</option>
                  {LINETYPES.map((l) => <option key={l} value={l}>{l.toLowerCase()}</option>)}
                </select>
                <NumberInput aria={`${layer} lineweight`} value={own.lineweight} placeholder="Drafting" suffix="mm" min={0} max={2.11} onError={onError}
                  onCommit={(v) => setLayer(layer, { lineweight: v })} />
              </Row>
              <Toggle label={`Plot ${layer}`} checked={own.plot ?? layer !== "GRID"} onChange={(on) => setLayer(layer, { plot: on })} />
            </div>
          );
        })}
      </Group>
    </Section>
  );
}
