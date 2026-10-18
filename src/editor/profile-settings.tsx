import { DEFAULT_FLANGE_ORDER, DEFAULT_MATERIAL_ORDER, profileOf, type FabricationProfile } from "../core/profile";
import { fieldFitMakeup, lengthInputValue, setFieldFitMakeup, type IsoDocument } from "../core/model";
import { LengthInput, Note, Row, Section, Segmented, TextInput } from "./inspector/kit";

type Commit = (edit: (d: IsoDocument) => void) => boolean | void;
const INCH = 25.4;

/**
 * The project's fabrication conventions (doc.profile): how pipe is bought and cut, how lengths are written, how
 * lists are ordered and welds numbered. Every field shows the default it falls back to when left empty.
 */
export function ProfileSettings({ doc, commit, onError }: { doc: IsoDocument; commit: Commit; onError: (message: string) => void }) {
  const own = doc.profile ?? {}, resolved = profileOf({ ...doc, profile: undefined }), units = doc.units;
  const set = <K extends keyof FabricationProfile>(key: K, value: FabricationProfile[K] | undefined) => commit((d) => {
    const p: FabricationProfile = { ...d.profile };
    if (value == null || (Array.isArray(value) && !value.length)) delete p[key];
    else p[key] = value;
    if (Object.keys(p).length) d.profile = p;
    else delete d.profile;
  });
  const length = (key: "stockLength" | "orderIncrement" | "kerf" | "bendAllowance", label: string, hint: string) => (
    <Row label={label} keywords="profile pipe order cut" hint={hint} modified={own[key] != null} onReset={() => set(key, undefined)}>
      <LengthInput aria={label} mm={own[key]} units={units} allowEmpty positive={key === "stockLength"} placeholder={lengthInputValue(resolved[key], units)} onError={onError}
        onCommit={(v) => set(key, v)} />
    </Row>
  );
  const list = (key: "materialOrder" | "flangeOrder", label: string, defaults: string[]) => (
    <Row label={label} keywords="profile order bill of materials" hint={`Comma separated; groups not named follow in the default order: ${defaults.join(", ")}.`}
      modified={!!own[key]?.length} onReset={() => set(key, undefined)}>
      <TextInput aria={label} value={(own[key] ?? []).join(", ")} placeholder={defaults.slice(0, 6).join(", ") + "…"} maxLength={1000}
        onCommit={(v) => set(key, v.split(",").map((x) => x.trim()).filter(Boolean))} />
    </Row>
  );
  return (
    <Section id="sheet.profile" title="Project profile" summary={Object.keys(own).length ? `${Object.keys(own).length} set` : "Defaults"}>
      <Note keywords="profile fabrication conventions">Fabrication conventions, saved with the drawing and read by every sheet, list and export. Empty fields use the default shown.</Note>
      {length("stockLength", "Stock pipe length", "Random length pipe is bought in; longer pieces are flagged. A specification's own stock length takes precedence.")}
      {length("orderIncrement", "Order rounding", "Ordered pipe length is rounded up to this; zero orders the exact length.")}
      {length("kerf", "Saw kerf", "Allowed between pieces cut from one length.")}
      {length("bendAllowance", "Bend allowance", "Extra length per formed bend, for grip or springback.")}
      <Row label="Field-fit makeup" keywords="field fit ffw trim" hint="Extra pipe left at each field-fit weld, trimmed on site." modified={doc.fieldFitMakeup != null}
        onReset={() => commit((d) => setFieldFitMakeup(d, undefined))}>
        <LengthInput aria="Field-fit makeup" mm={doc.fieldFitMakeup} units={units} allowEmpty placeholder={lengthInputValue(fieldFitMakeup({ ...doc, fieldFitMakeup: undefined }), units)}
          onError={onError} onCommit={(v) => commit((d) => setFieldFitMakeup(d, v))} />
      </Row>
      <Row label="Cut length in the material list" keywords="cut note description" group>
        <Segmented aria="Cut length in the material list" value={own.cutNote ?? resolved.cutNote} onChange={(v) => set("cutNote", v)}
          choices={[{ value: "description", label: "After the description" }, { value: "none", label: "Cut list only" }]} />
      </Row>
      {units === "imperial" && (["dimensions", "lists"] as const).map((use) => (
        <Row key={use} label={use === "dimensions" ? "Feet from (dimensions)" : "Feet from (lists)"} keywords="feet inches threshold"
          hint={`Shorter ${use} are written in inches only.`} modified={own.feetFrom?.[use] != null}
          onReset={() => set("feetFrom", { ...own.feetFrom, [use]: undefined })}>
          <LengthInput aria={`Feet threshold for ${use}`} mm={own.feetFrom?.[use] == null ? undefined : own.feetFrom[use]! * INCH} units={units} allowEmpty
            placeholder={lengthInputValue(resolved.feetFrom[use] * INCH, units)} onError={onError}
            onCommit={(v) => set("feetFrom", { ...own.feetFrom, [use]: v == null ? undefined : v / INCH })} />
        </Row>
      ))}
      <Row label="Sizes written as" keywords="nps dn notation" group>
        <Segmented aria="Size notation" value={own.sizeNotation ?? resolved.sizeNotation} onChange={(v) => set("sizeNotation", v)}
          choices={[{ value: "NPS", label: "NPS (inches)" }, { value: "DN", label: "DN" }]} />
      </Row>
      <Row label="Sizes in a group" keywords="order ascending descending" group>
        <Segmented aria="Size order" value={own.sizeOrder ?? resolved.sizeOrder} onChange={(v) => set("sizeOrder", v)}
          choices={[{ value: "ascending", label: "Smallest first" }, { value: "descending", label: "Largest first" }]} />
      </Row>
      <Row label="Material list" keywords="shop field sections" group>
        <Segmented aria="Material list sections" value={own.materialSections ?? resolved.materialSections} onChange={(v) => set("materialSections", v)}
          choices={[{ value: "combined", label: "One list" }, { value: "shop-field", label: "Shop, then field" }]} />
      </Row>
      {list("materialOrder", "Material group order", DEFAULT_MATERIAL_ORDER)}
      {list("flangeOrder", "Flange type order", DEFAULT_FLANGE_ORDER)}
      <Row label="Weld numbers" keywords="weld sequence numbering" group>
        <Segmented aria="Weld number sequence" value={own.weldSequence ?? resolved.weldSequence} onChange={(v) => set("weldSequence", v)}
          choices={[{ value: "drawing", label: "Through the drawing" }, { value: "spool", label: "Per spool" }]} />
      </Row>
      <Row label="Welds between spools" keywords="spool break weld field shop" group>
        <Segmented aria="Spool break welds" value={own.spoolBreakWelds ?? resolved.spoolBreakWelds} onChange={(v) => set("spoolBreakWelds", v)}
          choices={[{ value: "field", label: "Field" }, { value: "shop", label: "Shop" }]} />
      </Row>
    </Section>
  );
}
