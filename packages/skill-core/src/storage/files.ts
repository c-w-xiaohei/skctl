import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { SkctlError } from "../shared";

export async function assertPath(path: string, kind: "file" | "directory", optional = false) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  const parts = relative(current, absolute).split(sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stat) {
      if (optional) return;
      throw new SkctlError("CONFIG_INVALID", `Required ${kind} is missing: ${absolute}`);
    }
    const file = index === parts.length - 1 && kind === "file";
    if (stat.isSymbolicLink() || (file ? !stat.isFile() : !stat.isDirectory()))
      throw new SkctlError("CONFIG_SYMLINK", `Unsafe path: ${current}`);
  }
}

export async function ensureDirectory(path: string) {
  await assertPath(path, "directory", true);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await assertPath(path, "directory");
}

export function within(root: string, path: string) {
  const value = relative(resolve(root), resolve(path));
  return value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

export async function readOptional(path: string): Promise<Buffer | undefined> {
  return readFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

export async function writeSynced(path: string, bytes: string | Uint8Array, exclusive = false) {
  const file = await open(path, exclusive ? "wx" : "w", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function syncDirectory(path: string) {
  if (process.platform === "win32") return;
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function writeAtomic(path: string, bytes: string | Uint8Array) {
  await ensureDirectory(dirname(path));
  await assertPath(path, "file", true);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeSynced(temporary, bytes, true);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}
