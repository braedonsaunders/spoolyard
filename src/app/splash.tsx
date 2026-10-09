/** Opening splash: the spool draws itself — run, riser, run — then the wordmark settles in. */
export function Splash({ leaving }: { leaving: boolean }) {
  return (
    <div className={"sy-splash" + (leaving ? " leaving" : "")} aria-hidden>
      <svg className="sy-splash-route" viewBox="0 0 320 200" width="320" height="200">
        <defs>
          <linearGradient id="sy-route" x1="0" x2="1">
            <stop offset="0" stopColor="#5ce1f0" />
            <stop offset="1" stopColor="#16b3c9" />
          </linearGradient>
        </defs>
        <g className="sy-splash-grid">
          {Array.from({ length: 9 }, (_, i) => (
            <line key={"a" + i} x1={20 + i * 35} y1="0" x2={-95 + i * 35} y2="200" />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <line key={"b" + i} x1={-15 + i * 35} y1="0" x2={100 + i * 35} y2="200" />
          ))}
        </g>
        <path
          className="sy-splash-pipe"
          d="M52 146 L118 184 L118 76 L204 126 L270 88"
          pathLength={1}
        />
        <path className="sy-splash-flange" d="M57 137.3 L47 154.7 M265 79.3 L275 96.7" pathLength={1} />
        {[
          [118, 184],
          [118, 76],
          [204, 126],
        ].map(([x, y], i) => (
          <circle key={i} className="sy-splash-weld" cx={x} cy={y} r="5" style={{ animationDelay: 0.45 + i * 0.18 + "s" }} />
        ))}
      </svg>
      <div className="sy-splash-word">
        <strong>Spoolyard</strong>
        <span>Piping isometrics &amp; spool fabrication</span>
      </div>
    </div>
  );
}
