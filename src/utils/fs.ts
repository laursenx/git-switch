import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir } from "./paths.js";

/**
 * Write data to a file atomically: writes to a .tmp file first, then renames.
 * Ensures the parent directory exists.
 */
export function atomicWriteFile(filePath: string, data: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, filePath);
}
