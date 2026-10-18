import { parseLength, type IsoDocument, type Vec3 } from "../core/model";

/**
 * The command line: what a drafter types instead of picking. While a command waits for a point, a length goes the way
 * the cursor points, a direction and length goes that way ("N 10'", "2400 up"), and "@dE,dN,dEL" is a relative offset
 * in plant axes. Otherwise a word starts a command, by its name or its AutoCAD-style alias.
 */
export type PointInput =
  | { kind: "delta"; delta: Vec3 }
  | { kind: "direction"; direction: Vec3; length: number }
  /** Along the cursor; negative goes against it. */
  | { kind: "length"; length: number };

export const DIRECTIONS: Array<{ name: string; words: string[]; vector: Vec3 }> = [
  { name: "East", words: ["E", "EAST"], vector: [1, 0, 0] },
  { name: "West", words: ["W", "WEST"], vector: [-1, 0, 0] },
  { name: "North", words: ["N", "NORTH"], vector: [0, 1, 0] },
  { name: "South", words: ["S", "SOUTH"], vector: [0, -1, 0] },
  { name: "Up", words: ["U", "UP"], vector: [0, 0, 1] },
  { name: "Down", words: ["D", "DN", "DOWN"], vector: [0, 0, -1] },
];
const direction = (word: string) => DIRECTIONS.find((d) => d.words.includes(word.toUpperCase()))?.vector;
const DIRECTION_WORDS = DIRECTIONS.flatMap((d) => d.words).sort((a, b) => b.length - a.length).join("|");
const LEADING = new RegExp(`^(${DIRECTION_WORDS})(?![a-z])\\s*(.+)$`, "i");
const TRAILING = new RegExp(`^(.+?)\\s*(?<![a-z])(${DIRECTION_WORDS})$`, "i");

/** A typed point, offset or distance; throws a message saying what was expected. */
export function parsePointInput(raw: string, units: IsoDocument["units"]): PointInput {
  const text = raw.trim();
  if (!text) throw new Error("Type a length, a direction and length (N 10'), or an offset @E,N,EL.");
  if (text.startsWith("@")) {
    const parts = text.slice(1).split(",").map((v) => v.trim());
    if (parts.length < 2 || parts.length > 3 || parts.some((p) => !p)) throw new Error("Type a relative offset as @E,N,EL, for example @0,1500,300.");
    const delta = [0, 1, 2].map((i) => (parts[i] ? parseLength(parts[i], units, true) : 0)) as Vec3;
    if (delta.every((v) => v === 0)) throw new Error("The offset is zero; type how far to go.");
    return { kind: "delta", delta };
  }
  if (text.includes(",")) throw new Error("Start a relative offset with @, for example @0,1500,300.");
  const lead = LEADING.exec(text), trail = lead ? null : TRAILING.exec(text);
  const [word, amount] = lead ? [lead[1], lead[2]] : trail ? [trail[2], trail[1]] : [undefined, text];
  // A negative distance goes the other way, as AutoCAD's direct distance entry does: "N -600" is 600 south.
  const signed = parseLength(amount, units, true);
  if (!Number.isFinite(signed) || Math.abs(signed) < 1e-9) throw new Error("Type a length greater than zero.");
  if (word) {
    const along = direction(word)!;
    return { kind: "direction", direction: signed < 0 ? (along.map((v) => -v || 0) as Vec3) : along, length: Math.abs(signed) };
  }
  return { kind: "length", length: signed };
}

/** The plant offset a typed input asks for, given the axis the cursor points along (for a bare length). */
export function inputDelta(input: PointInput, pointing: Vec3 | null): Vec3 {
  if (input.kind === "delta") return input.delta;
  const along = input.kind === "direction" ? input.direction : pointing;
  if (!along) throw new Error("Point the cursor the way the pipe goes, or type a direction: N 10', U 600, @0,0,600.");
  return along.map((v) => v * input.length || 0) as Vec3;
}

/** The iso axis a plant offset mostly runs along, as a unit vector; null for none. */
export function dominantAxis(v: Vec3): Vec3 | null {
  let best = -1, size = 0;
  v.forEach((x, i) => { if (Math.abs(x) > size) { size = Math.abs(x); best = i; } });
  if (best < 0 || size < 1e-9) return null;
  const out: Vec3 = [0, 0, 0];
  out[best] = Math.sign(v[best]);
  return out;
}

export type CommandId =
  | "select" | "pan" | "pipe" | "insert" | "move" | "copy" | "erase" | "measure" | "zoom-extents" | "zoom-window"
  | "zoom-previous" | "zoom-sheet" | "undo" | "redo" | "grid" | "snap" | "ortho" | "osnap" | "help";
export interface CommandInfo {
  id: CommandId;
  label: string;
  /** Typed names, longest first; the first is shown as the alias. */
  names: string[];
  /** Repeated by Enter or Space after it ends. */
  repeatable?: boolean;
}
export const COMMANDS: CommandInfo[] = [
  { id: "select", label: "Select", names: ["SELECT", "V"] },
  { id: "pan", label: "Pan", names: ["PAN", "H"] },
  { id: "pipe", label: "Pipe", names: ["PIPE", "P", "L", "LINE"], repeatable: true },
  { id: "insert", label: "Insert component", names: ["INSERT", "I"], repeatable: true },
  { id: "move", label: "Move", names: ["MOVE", "M"], repeatable: true },
  { id: "copy", label: "Copy", names: ["COPY", "CO", "CP"], repeatable: true },
  { id: "erase", label: "Erase", names: ["ERASE", "DELETE", "E"] },
  { id: "measure", label: "Measure distance", names: ["MEASURE", "DIST", "DI"], repeatable: true },
  { id: "zoom-extents", label: "Zoom extents", names: ["ZOOM E", "Z E", "ZE"] },
  { id: "zoom-window", label: "Zoom window", names: ["ZOOM W", "Z W", "ZW"], repeatable: true },
  { id: "zoom-previous", label: "Zoom previous", names: ["ZOOM P", "Z P", "ZP"] },
  { id: "zoom-sheet", label: "Zoom to sheet", names: ["ZOOM S", "Z S", "ZOOM A", "Z A"] },
  { id: "undo", label: "Undo", names: ["UNDO", "U"] },
  { id: "redo", label: "Redo", names: ["REDO"] },
  { id: "grid", label: "Grid on/off", names: ["GRID"] },
  { id: "snap", label: "Snap on/off", names: ["SNAP"] },
  { id: "ortho", label: "Ortho on/off", names: ["ORTHO"] },
  { id: "osnap", label: "Object snap on/off", names: ["OSNAP", "OS"] },
  { id: "help", label: "Keyboard shortcuts", names: ["HELP", "?"] },
];
/** The command a typed word names, or undefined. */
export function parseCommand(raw: string): CommandInfo | undefined {
  const text = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!text) return undefined;
  return COMMANDS.find((c) => c.names.includes(text));
}
/** Commands whose names start with what has been typed, for completion. */
export function completeCommand(raw: string): CommandInfo[] {
  const text = raw.trim().toUpperCase();
  if (!text) return [];
  return COMMANDS.filter((c) => c.names.some((n) => n.startsWith(text)) || c.label.toUpperCase().startsWith(text));
}
