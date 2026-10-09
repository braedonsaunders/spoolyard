import { COMPONENT_TYPES } from "../core/components";
import { symbolStrokes } from "../core/symbols";
import type { Kind } from "../core/model";

const kinds = new Map(COMPONENT_TYPES.map((t) => [t.code, t.kind]));

/** Catalogue thumbnail drawn from the same strokes as the sheet symbol, with the pipe it sits on. */
export function ComponentGlyph({ code, kind, size = 18 }: { code: string; kind?: Kind; size?: number }) {
  const k = kind ?? kinds.get(code) ?? (code === "PIPE" ? "pipe" : "valve");
  const onPipe = k !== "annotation" && k !== "pipe" && !k.startsWith("elbow") && k !== "tee";
  return (
    <svg className="iso-glyph" width={size} height={size} viewBox="-20 -20 40 40" aria-hidden>
      {onPipe && <line x1={-19} y1={0} x2={19} y2={0} className="iso-glyph-pipe" />}
      {symbolStrokes(code, k).map((s, i) =>
        "l" in s ? (
          <line key={i} x1={s.l[0]} y1={s.l[1]} x2={s.l[2]} y2={s.l[3]} />
        ) : "c" in s ? (
          <circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} className={s.fill ? "fill" : undefined} />
        ) : (
          <text key={i} x={s.at[0]} y={s.at[1]} fontSize={s.size ?? 9}>
            {s.t}
          </text>
        ),
      )}
    </svg>
  );
}
