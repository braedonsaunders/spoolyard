/** The Spoolyard mark: an isometric spool — two runs, a riser and welded flanges — on a teal tile. */
export function SpoolyardMark({ size = 22, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id="spoolyard-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#16b3c9" />
          <stop offset="1" stopColor="#0b6f8f" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#spoolyard-tile)" />
      <g transform="translate(0 -4)">
      <path d="M6.5 21.5 L13 25.2 L13 14.4 L19.5 18.1 L25.5 14.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.4 19.9 L5.6 23.1 M24.6 13.1 L26.4 16.2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="13" cy="25.2" r="1.7" fill="#bff3fb" />
      <circle cx="13" cy="14.4" r="1.7" fill="#bff3fb" />
      <circle cx="19.5" cy="18.1" r="1.7" fill="#bff3fb" />
      </g>
    </svg>
  );
}
