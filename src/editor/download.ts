/** UTF-8 byte-order mark: spreadsheet programs (Excel) read a CSV as UTF-8 only when it starts with one. */
export const UTF8_BOM = "﻿";
/** Save generated content through the browser's download prompt. CSV text is saved as UTF-8 with its byte-order mark. */
export function download(name: string, content: Blob | string, mime = "text/plain"): void {
  const csv = typeof content === "string" && /^text\/csv/.test(mime);
  const blob = typeof content === "string"
    ? new Blob([csv && !content.startsWith(UTF8_BOM) ? UTF8_BOM + content : content], { type: csv ? "text/csv;charset=utf-8" : mime })
    : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
