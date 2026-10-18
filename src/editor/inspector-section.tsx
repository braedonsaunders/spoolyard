import { useState } from 'react';

/** Left edge grows the inspector toward the drawing; arrow keys provide the same adjustment. */
export function InspectorResize({ width = 320, onResize }: { width?: number; onResize: (width: number) => void }) {
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null);
  const size = (element: HTMLElement) => element.nextElementSibling?.getBoundingClientRect().width ?? 320;
  const change = (width: number) => onResize(Math.max(220, Math.min(480, window.innerWidth * .6, width)));
  return <div className="iso-inspector-resize" role="separator" aria-label="Resize properties panel" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={220} aria-valuemax={480} tabIndex={0}
    onPointerDown={e => { if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setDrag({x:e.clientX,width:size(e.currentTarget)}); }}
    onPointerMove={e => { if(drag)change(drag.width+drag.x-e.clientX); }}
    onPointerUp={e => { setDrag(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId); }}
    onPointerCancel={()=>setDrag(null)}
    onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();change(size(e.currentTarget)+(e.key==='ArrowLeft'?20:-20));}}}/>
}
