const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const pending = new Map();

/** Commit a complete file in one rename; interrupted writes leave the previous drawing intact. */
function writeDrawing(filePath, content) {
  const target = path.resolve(filePath);
  const previous = pending.get(target) ?? Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const temporary = path.join(path.dirname(target), "." + path.basename(target) + "." + randomUUID() + ".tmp");
    let file;
    try {
      const existing = await fs.stat(target).catch((e) => { if (e.code !== "ENOENT") throw e; });
      file = await fs.open(temporary, "wx", existing?.mode ?? 0o600);
      await file.writeFile(content, "utf8");
      await file.sync();
      await file.close();
      file = null;
      await fs.rename(temporary, target);
    } finally {
      await file?.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  });
  pending.set(target, write);
  void write.finally(() => { if (pending.get(target) === write) pending.delete(target); }).catch(() => {});
  return write;
}

module.exports = { writeDrawing };
