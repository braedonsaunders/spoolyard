import { memo, useEffect, useState } from "react";
import { createDrawing, drawingSvg } from "../core/drawing";
import { readIsometric } from "../core/document";

/** A sheet preview of a stored drawing, rendered when the browser is idle. */
export const Thumbnail = memo(function Thumbnail({ content }: { content: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      try {
        const markup = content.trim() ? drawingSvg(createDrawing(readIsometric(content))) : "";
        if (!cancelled) setSvg(markup);
      } catch {
        if (!cancelled) setSvg("");
      }
    };
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 30));
    const handle = idle(run);
    return () => {
      cancelled = true;
      (window.cancelIdleCallback ?? window.clearTimeout)(handle as number);
    };
  }, [content]);
  return <div className="sy-thumb" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
});
