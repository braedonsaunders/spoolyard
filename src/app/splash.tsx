import { SpoolyardMark } from "../editor/mark";

/** Opening splash: the spool draws in, the bolts pop in tightening order, then the wordmark rises. */
export function Splash({ leaving }: { leaving: boolean }) {
  return (
    <div className={"sy-splash" + (leaving ? " leaving" : "")} aria-hidden>
      <SpoolyardMark size={132} animated />
      <div className="sy-splash-word">
        <strong>
          spool<em>yard</em>
        </strong>
        <span>Piping isometrics · spool drawings</span>
      </div>
    </div>
  );
}
