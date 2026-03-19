import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXTENSION_NAME } from "./constants";

function workspaceHash(workspaceFolderPath: string): string {
  return createHash("sha256").update(workspaceFolderPath).digest("hex").slice(0, 8);
}

export function socketPath(workspaceFolderPath: string): string {
  return join(tmpdir(), `${EXTENSION_NAME}-${workspaceHash(workspaceFolderPath)}.sock`);
}
