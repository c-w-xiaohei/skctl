import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { SkillCliError } from "../api";

export type RuntimePhase =
  | "download.parent-lstat"
  | "download.destination-lstat"
  | "download.open"
  | "download.write"
  | "download.sync"
  | "download.close"
  | "download.link"
  | "download.rename"
  | "download.published"
  | "download.cleanup"
  | "run.spawn"
  | "run.cleanup";

// This is deliberately operation-shaped rather than a general platform abstraction.
export interface RuntimeHooks {
  at?(phase: RuntimePhase): void | Promise<void>;
}
export interface RunRootDependencies {
  readonly base?: string;
  readonly now?: () => number;
  readonly pidAbsent?: (pid: number) => boolean;
}

export async function runtimeAt(
  hooks: RuntimeHooks | undefined,
  phase: RuntimePhase,
): Promise<void> {
  await hooks?.at?.(phase);
}

interface RunOwner {
  readonly version: 1;
  readonly pid: number;
  readonly nonce: string;
  readonly state: "building" | "ready";
  readonly createdAt: number;
  readonly heartbeatAt: number;
}

async function writeOwner(path: string, owner: RunOwner): Promise<void> {
  const temporary = `${path}.${owner.nonce}.tmp`;
  await writeFile(temporary, JSON.stringify(owner), { mode: 0o600 });
  await rename(temporary, path);
}

function definitelyAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}

export async function recoverStaleRunRoots(
  base: string,
  dependencies?: RunRootDependencies,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith("run-"))
      .map(async (entry) => {
        const directory = join(base, entry);
        try {
          const owner = JSON.parse(
            await readFile(join(directory, "owner.json"), "utf8"),
          ) as RunOwner;
          if (
            owner.version === 1 &&
            typeof owner.pid === "number" &&
            typeof owner.heartbeatAt === "number" &&
            (dependencies?.now ?? Date.now)() - owner.heartbeatAt > 86_400_000 &&
            (dependencies?.pidAbsent ?? definitelyAbsent)(owner.pid)
          )
            await rm(directory, { recursive: true, force: true });
        } catch {
          /* Unknown ownership is intentionally retained. */
        }
      }),
  );
}

export interface OwnedRunRoot {
  readonly directory: string;
  readonly root: string;
  ready(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createRunRoot(
  hooks?: RuntimeHooks,
  dependencies?: RunRootDependencies,
): Promise<OwnedRunRoot> {
  const base = dependencies?.base ?? join(tmpdir(), "skill-cli");
  await mkdir(base, { recursive: true, mode: 0o700 });
  await recoverStaleRunRoots(base, dependencies);
  const nonce = crypto.randomUUID();
  const directory = join(base, `run-${nonce}`);
  const root = join(directory, "root");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const createdAt = (dependencies?.now ?? Date.now)();
  let state: RunOwner["state"] = "building";
  const publish = () =>
    writeOwner(join(directory, "owner.json"), {
      version: 1,
      pid: process.pid,
      nonce,
      state,
      createdAt,
      heartbeatAt: (dependencies?.now ?? Date.now)(),
    });
  await publish();
  const heartbeat = setInterval(() => {
    void publish().catch(() => undefined);
  }, 30_000);
  return {
    directory,
    root,
    async ready() {
      state = "ready";
      await publish();
    },
    async dispose() {
      clearInterval(heartbeat);
      await rm(directory, { recursive: true, force: true });
      await runtimeAt(hooks, "run.cleanup");
    },
  };
}

export async function publishConfig(
  path: string,
  bytes: string,
  defaultMode: number,
  nonce: string,
  signal?: AbortSignal,
): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.tmp.${nonce}`);
  try {
    let mode = defaultMode;
    try {
      const target = await lstat(path);
      if (target.isSymbolicLink())
        throw new SkillCliError("CONFIG_SYMLINK", `Configuration file is a symlink: ${path}`);
      mode = target.mode & 0o777;
    } catch (error) {
      if (error instanceof SkillCliError) throw error;
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT")
        throw new SkillCliError("WRITE_FAILED", `Unable to inspect configuration: ${path}`);
    }
    const handle = await open(temporary, "wx", mode);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    try {
      const target = await lstat(path);
      if (target.isSymbolicLink())
        throw new SkillCliError("CONFIG_SYMLINK", `Configuration file is a symlink: ${path}`);
    } catch (error) {
      if (error instanceof SkillCliError) throw error;
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (error instanceof SkillCliError) throw error;
    throw new SkillCliError("WRITE_FAILED", `Unable to publish configuration: ${path}`);
  }
}
