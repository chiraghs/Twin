import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Facts about where this server runs and where it keeps local files. */

/** Ephemeral container filesystems (TWIN_EPHEMERAL_STORAGE=true), where only /tmp is writable. */
export const isServerless = () => process.env.TWIN_EPHEMERAL_STORAGE === "true";

/** A public deployment (TWIN_DEPLOYMENT=public): admin needs a passcode, never open. */
export const isPublicDeployment = () => process.env.TWIN_DEPLOYMENT === "public";

/** Directory for local JSON files: TWIN_DATA_DIR, else /tmp/twin on serverless runtimes, else ./.data. */
export const dataDir = () => process.env.TWIN_DATA_DIR || (isServerless() ? path.join(os.tmpdir(), "twin") : path.join(process.cwd(), ".data"));

/** Write a file atomically (temp file next to it, then rename), creating its directory if needed. */
export function writeFileAtomic(file: string, data: string, options?: fs.WriteFileOptions) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, options);
  fs.renameSync(tmp, file);
}

/** A file path for display: relative to the working directory when it is inside it, else absolute. */
export function displayPath(file: string) {
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith("..") ? file : rel;
}
