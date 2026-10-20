import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { SkctlError } from "../shared";
import { assertPath, within } from "../storage/files";
import { decodeStrictText } from "./text";

/** Content identity includes names, directory structure, bytes and executable bits. */
export async function digestDirectory(path: string): Promise<string> {
  const root = resolve(path);
  await assertPath(root, "directory", true).catch((error) => {
    if (error instanceof SkctlError && error.code === "CONFIG_SYMLINK")
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Skill directory prefix is unsafe");
    throw error;
  });
  const hash = new Bun.CryptoHasher("sha256");
  const visit = async (directory: string, relative: string): Promise<void> => {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Skill directory is unavailable");
    hash.update(`directory\0${relative}\0`);
    const names = (await readdir(directory)).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
    for (const name of names) {
      const child = join(directory, name),
        key = relative ? `${relative}/${name}` : name;
      const before = await lstat(child);
      if (name === ".git")
        throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Skill contains a gitlink");
      if (before.isSymbolicLink()) {
        const target = await readlink(child);
        const destination = resolve(dirname(child), target);
        const targetStat = await lstat(destination).catch(() => undefined);
        if (
          !target ||
          isAbsolute(target) ||
          !within(root, destination) ||
          !targetStat ||
          targetStat.isSymbolicLink() ||
          (!targetStat.isFile() && !targetStat.isDirectory())
        )
          throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Skill contains an unsafe link");
        await assertPath(destination, targetStat.isFile() ? "file" : "directory");
        hash.update(`symlink\0${key}\0${target}\0`);
      } else if (before.isDirectory()) await visit(child, key);
      else if (before.isFile()) {
        hash.update(`file\0${key}\0${before.mode & 0o111 ? 1 : 0}\0${before.size}\0`);
        for await (const bytes of createReadStream(child)) hash.update(bytes);
        const after = await lstat(child);
        if (
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mode !== after.mode ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs
        )
          throw new SkctlError("TRANSACTION_CONFLICT", "Skill changed while hashing");
      } else throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Skill contains an unsafe entry");
    }
  };
  await visit(root, "");
  const marker = join(root, "SKILL.md");
  const stat = await lstat(marker).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Skill has no ordinary SKILL.md");
  decodeStrictText(await readFile(marker));
  return hash.digest("hex");
}
