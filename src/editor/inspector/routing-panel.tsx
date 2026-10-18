import { coordinateText } from "../../core/format";
import { parseLength, type IsoDocument, type Vec3 } from "../../core/model";
import { KIND_LABELS, SpoolInput } from "../choices";
import { Actions, Note, Row, Section, TextInput } from "./kit";

export interface RoutingProps {
  doc: IsoDocument;
  spool: string;
  spools: string[];
  setSpool: (spool: string) => void;
  line: string;
  setLine: (line: string) => void;
  start: string;
  selectConnection: (id: string) => void;
  /** Route a pipe by a typed offset from the current connection. */
  route: (delta: Vec3) => void;
  onError: (message: string) => void;
  /** Collapsed by default under a selection; open when nothing is selected. */
  idle?: boolean;
}

/** Where the next pipe goes: its spool and line, the connection it leaves from, and a typed rolling offset. */
export function RoutingSections({ doc, spool, spools, setSpool, line, setLine, start, selectConnection, route, onError, idle }: RoutingProps) {
  const free = doc.nodes.filter((n) => !n.associatedRunId);
  const from = doc.nodes.find((n) => n.id === start);
  const name = (n: (typeof free)[number]) => `${KIND_LABELS[n.kind] ?? n.kind} ${free.indexOf(n) + 1}`;
  return (
    <>
      <Section id={idle ? "routing.idle" : "routing.selection"} title="Routing" defaultOpen={idle} summary={[spool, line, "from " + (from ? name(from) : "a new origin")].filter(Boolean).join(" · ")}>
        <Row label="Spool" keywords="routing new pipe">
          <SpoolInput aria="Routing spool" value={spool} spools={spools} onChange={setSpool} />
        </Row>
        <Row label="Line number" keywords="routing new pipe">
          <TextInput aria="Routing line number" value={line} trim maxLength={120} onCommit={(v) => setLine(v)} />
        </Row>
        <Row label="Continue from" keywords="routing start connection origin">
          <select aria-label="Continue from" value={start} onChange={(e) => selectConnection(e.target.value)}>
            <option value="">New origin</option>
            {free.map((n) => <option value={n.id} key={n.id}>{name(n)} · {coordinateText(doc, n.position).join(" ")}</option>)}
          </select>
        </Row>
        <Note>Pipe cuts subtract fitting takeouts and root gaps. Select a connection on the drawing to continue or branch from it.</Note>
      </Section>
      <Section id={idle ? "routing.offset.idle" : "routing.offset"} title="Rolling offset" summary="Route by E · N · EL">
        <form className="insp-form" onSubmit={(e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          try {
            route(["x", "y", "z"].map((k) => parseLength(String(values.get(k) || "0"), doc.units, true)) as Vec3);
          } catch (err) {
            onError(err instanceof Error ? err.message : String(err));
          }
        }}>
          {([["x", "East (− West)"], ["y", "North (− South)"], ["z", "Up (− Down)"]] as const).map(([k, label]) => (
            <Row key={k} label={label} keywords="rolling offset routing">
              <input name={k} aria-label={`Offset ${label}`} defaultValue="0" onKeyDown={(e) => e.stopPropagation()} />
            </Row>
          ))}
          <Note>Or type the offset in the command line while routing: @E,N,EL, for example @600,0,300.</Note>
          <Actions keywords="rolling offset route">
            <button type="submit" className="is-primary">Route offset</button>
          </Actions>
        </form>
      </Section>
    </>
  );
}
