import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceTmp = fileURLToPath(new URL("../../../tmp/", import.meta.url));

// The resource runner mounts the OS temp directory noexec. Only PATH shims need
// this executable location; callers own cleanup of the unique fixture directory.
export async function createExecutableFixture() {
  await mkdir(workspaceTmp, { recursive: true });
  return mkdtemp(join(workspaceTmp, "skctl-provider-shim-"));
}
