import { memo, useEffect, useState } from "react";
import { createDrawing, drawingSvg } from "../core/drawing";
import { readIsometric } from "../core/document";

/**
 * A sheet preview of a stored drawing, rendered when the browser is idle. The sheet is shown as an image of its SVG,
 * never inserted as markup: an image cannot run script or reach the page, whatever a stored drawing contains.
 */
export const Thumbnail = memo(function Thumbnail({ content }: { content: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let cancelled = false,
      url = "";
    const run = () => {
      try {
        const markup = content.trim() ? drawingSvg(createDrawing(readIsometric(content))) : "";
        if (cancelled) return;
        url = markup ? URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" })) : "";
        setSrc(url);
      } catch {
        if (!cancelled) setSrc("");
      }
    };
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 30));
    const handle = idle(run);
    return () => {
      cancelled = true;
      (window.cancelIdleCallback ?? window.clearTimeout)(handle as number);
      if (url) URL.revokeObjectURL(url);
    };
  }, [content]);
  return <div className="sy-thumb" aria-hidden>{src ? <img src={src} alt="" draggable={false} /> : null}</div>;
});
