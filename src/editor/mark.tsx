import { MARK } from "./mark-geometry";

/**
 * The Spoolyard mark: an isometric pipe spool — a pipe between two bolted flanges — drawn in true
 * isometric with hidden lines resolved by painting back to front. `animated` draws it in and pops the
 * bolts in cross-pattern tightening order (used by the splash).
 */
export function SpoolyardMark({
  size = 24,
  title,
  animated = false,
  className,
}: {
  size?: number;
  title?: string;
  animated?: boolean;
  className?: string;
}) {
  const a = (delay: number, kind = "o") =>
    animated ? { className: "sy-mark-" + kind, style: { animationDelay: delay + "s" } } : {};
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={"sy-mark" + (className ? " " + className : "")}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <g stroke="var(--sy-mark-ink)" strokeWidth={MARK.stroke} strokeLinejoin="round" fill="var(--sy-mark-paper)">
        <path {...a(0.05)} pathLength={1} d={MARK.backRim} />
        <path {...a(0.15)} pathLength={1} d={MARK.backFace} />
        <path {...a(0.3)} pathLength={1} d={MARK.pipe} />
        <path {...a(0.45)} pathLength={1} d={MARK.frontRim} />
        <path {...a(0.55)} pathLength={1} d={MARK.frontFace} />
        <path {...a(0.7, "bore")} d={MARK.bore} fill="var(--sy-mark-hole)" />
        {MARK.bolts.map(([x, y], i) => (
          <circle key={i} {...a(0.8 + i * 0.09, "bolt")} cx={x} cy={y} r={MARK.boltR} fill="var(--sy-accent)" stroke="none" />
        ))}
      </g>
    </svg>
  );
}
