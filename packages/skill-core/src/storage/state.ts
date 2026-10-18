import {
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { SkillCliError } from "../shared";
import { bindingDigest } from "../source/identity";
import { decodeStrictText, parseSkillMetadata } from "../content/text";
import {
  validateState,
  validateCurrentMaterialization,
  validateTransaction,
  validateLockOwner,
  validateConfigIdentity,
  validateSnapshotUse,
  validateTombstoneOwner,
  type PrivateState,
  type InstalledMaterialization,
  type RemoteInstalledMaterialization,
  type Transaction,
  type TransactionTarget,
  type LockOwner,
  type StateContents,
  type SnapshotUse,
} from "./schema";
export type CoordinatorHook = (name: string) => void | Promise<void>;
export interface ProcessTokenDependencies {
  readonly platform?: string;
  readonly startToken?: (pid: number) => Promise<string | undefined>;
  readonly lockTimeoutMs?: number;
}
let hook: CoordinatorHook | undefined;
let semanticStateReadHook: (() => void) | undefined;
/** Test-only deterministic filesystem seam. It is intentionally not part of the public API. */
export function setCoordinatorHookForTest(next?: CoordinatorHook) {
  hook = next;
}
/** Test-only observation of the one semantic private-state capture in a workspace read. */
export function setSemanticStateReadHookForTest(next?: () => void) {
  semanticStateReadHook = next;
}
const signal = async (name: string) => {
  await hook?.(name);
  if (process.env.SKILL_CLI_TEST_BARRIER_AT === name) {
    const release = process.env.SKILL_CLI_TEST_BARRIER_RELEASE;
    if (!release) throw new Error("Barrier release path is required");
    while (!(await lstat(release).catch(() => undefined))) await Bun.sleep(10);
  }
  // Private child-process crash seam used only by transaction integration tests.
  if (process.env.SKILL_CLI_TEST_CRASH_AT === name) process.exit(97);
};
const empty = (): PrivateState => ({ version: 3, generation: 0, installed: [], configs: {} });
const hash = (value: Uint8Array) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const same = (value: Uint8Array | undefined, digest: string | null) =>
  (value ? hash(value) : null) === digest;

export function resolveStateRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform = process.platform,
): string {
  if (env.SKILL_CLI_STATE_DIR !== undefined) {
    if (!isAbsolute(env.SKILL_CLI_STATE_DIR))
      throw new SkillCliError("INVALID_ARGUMENT", "SKILL_CLI_STATE_DIR must be absolute");
    return resolve(env.SKILL_CLI_STATE_DIR);
  }
  if (platform === "win32") return join(env.LOCALAPPDATA ?? env.HOME ?? "", "skill-cli");
  if (platform === "darwin")
    return join(env.HOME ?? "", "Library", "Application Support", "skill-cli");
  return join(env.XDG_STATE_HOME ?? join(env.HOME ?? "", ".local", "state"), "skill-cli");
}

async function sync(path: string) {
  await signal("sync");
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function readBytes(path: string): Promise<Uint8Array | undefined> {
  await signal("open");
  return readFile(path).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? undefined : Promise.reject(error),
  );
}
function parseState(bytes: Uint8Array | undefined): PrivateState {
  if (!bytes) return empty();
  let value: unknown;
  try {
    value = JSON.parse(decodeStrictText(bytes));
  } catch {
    throw new SkillCliError("CONFIG_INVALID", "Invalid private state");
  }
  if (!validateState(value)) throw new SkillCliError("CONFIG_INVALID", "Invalid private state");
  return value;
}

export class StateCoordinator {
  private static readonly lockContext = new AsyncLocalStorage<string>();
  readonly root: string;
  constructor(
    root = resolveStateRoot(),
    private readonly processTokens: ProcessTokenDependencies = {},
  ) {
    this.root = resolve(root);
  }
  private get statePath() {
    return join(this.root, "state.json");
  }
  private get lockPath() {
    return join(this.root, "mutation.lock");
  }
  private get electionPath() {
    return join(this.root, "mutation.election");
  }
  private managed(path: string) {
    const absolute = resolve(path);
    if (
      relative(this.root, absolute).startsWith("..") ||
      (!relative(this.root, absolute) && absolute !== this.root)
    )
      throw new SkillCliError("CONFIG_SYMLINK", "State path escapes configured root");
    return absolute;
  }
  private async check(path: string, kind: "file" | "directory", optional = true) {
    const absolute = this.managed(path);
    const pieces = relative(this.root, absolute).split(/[/\\]/u).filter(Boolean);
    let current = this.root;
    for (let index = 0; index <= pieces.length; index += 1) {
      if (index > 0) current = join(current, pieces[index - 1]!);
      const stat = await lstat(current).catch(() => undefined);
      if (!stat) {
        if (index === pieces.length && optional) return;
        continue;
      }
      const expected = index === pieces.length ? kind : "directory";
      if (stat.isSymbolicLink() || (expected === "file" ? !stat.isFile() : !stat.isDirectory()))
        throw new SkillCliError("CONFIG_SYMLINK", `Unsafe state entry: ${current}`);
    }
  }
  private async ensureRoot() {
    const parts = this.root.split(/[/\\]/u).filter(Boolean);
    let current = this.root.startsWith("/") ? "/" : "";
    for (const part of parts) {
      current = current === "/" ? join(current, part) : current ? join(current, part) : part;
      const stat = await lstat(current).catch(() => undefined);
      if (stat && (stat.isSymbolicLink() || !stat.isDirectory()))
        throw new SkillCliError("CONFIG_SYMLINK", `Unsafe state root parent: ${current}`);
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.check(this.root, "directory", false);
    // This stable parent prevents tombstone preparation/release races.
    await this.mutableDir(join(this.root, "locks"));
  }
  private async lockOwner(path: string): Promise<LockOwner | undefined> {
    try {
      const value: unknown = JSON.parse(decodeStrictText((await readBytes(path))!));
      return validateLockOwner(value)
        ? {
            pid: value.pid,
            nonce: value.nonce,
            ...(typeof value.startToken === "string" ? { startToken: value.startToken } : {}),
          }
        : undefined;
    } catch {
      return undefined;
    }
  }
  private sameOwner(left: LockOwner, right: LockOwner) {
    return (
      left.pid === right.pid && left.nonce === right.nonce && left.startToken === right.startToken
    );
  }
  private sameInode(
    left: { readonly dev: number; readonly ino: number },
    right: { readonly dev: number; readonly ino: number },
  ) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  private async elected<T>(deadline: number, operation: () => Promise<T>): Promise<T> {
    const ticket = join(this.root, "locks", `ticket-${crypto.randomUUID()}`);
    const startToken = await this.startToken(process.pid);
    await this.writeSynced(
      ticket,
      JSON.stringify({
        pid: process.pid,
        nonce: crypto.randomUUID(),
        ...(startToken ? { startToken } : {}),
      }),
    );
    try {
      while (true) {
        try {
          await link(ticket, this.electionPath);
          try {
            return await operation();
          } finally {
            await rm(this.electionPath, { force: true });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const claim = join(this.root, "locks", `election-${crypto.randomUUID()}`);
          try {
            await link(this.electionPath, claim);
            const owner = await this.lockOwner(claim);
            const [shared, captured] = await Promise.all([
              lstat(this.electionPath).catch(() => undefined),
              lstat(claim),
            ]);
            if (
              owner &&
              shared &&
              this.sameInode(shared, captured) &&
              (await this.ownerLiveness(owner.pid, owner.startToken)) === "dead"
            ) {
              const current = await lstat(this.electionPath).catch(() => undefined);
              if (current && this.sameInode(current, captured))
                await rm(this.electionPath, { force: true });
            }
          } catch (claimError) {
            if ((claimError as NodeJS.ErrnoException).code !== "ENOENT") throw claimError;
          } finally {
            await rm(claim, { force: true });
          }
          if (Date.now() >= deadline)
            throw new SkillCliError("LOCK_TIMEOUT", "State mutation lock is held");
          await Bun.sleep(10);
        }
      }
    } finally {
      await rm(ticket, { force: true });
    }
  }
  private async detachObservedLock(owner: LockOwner, deadline: number) {
    return this.elected(deadline, async () => {
      const fence = join(this.root, "locks", `fence-${crypto.randomUUID()}`);
      try {
        await link(this.lockPath, fence);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
      try {
        const captured = await this.lockOwner(fence);
        if (!captured || !this.sameOwner(captured, owner)) return false;
        await signal("lock-fenced");
        const [shared, claim] = await Promise.all([
          lstat(this.lockPath).catch(() => undefined),
          lstat(fence),
        ]);
        if (!shared || !this.sameInode(shared, claim)) return false;
        await rm(this.lockPath, { force: true });
        return true;
      } finally {
        await rm(fence, { force: true });
      }
    });
  }
  private async removeOwnedLock(
    owner: LockOwner,
    deadline = Date.now() + (this.processTokens.lockTimeoutMs ?? 5_000),
  ) {
    await this.detachObservedLock(owner, deadline);
  }
  private async acquire(): Promise<LockOwner> {
    const deadline = Date.now() + (this.processTokens.lockTimeoutMs ?? 5_000);
    const startToken = await this.startToken(process.pid);
    const owner = {
      pid: process.pid,
      nonce: crypto.randomUUID(),
      ...(startToken ? { startToken } : {}),
    };
    const ownerPath = join(this.root, "locks", `owner-${owner.nonce}`);
    await this.writeSynced(ownerPath, JSON.stringify(owner));
    while (true) {
      try {
        await link(ownerPath, this.lockPath);
        await signal("lock-published");
        await signal("lock-critical-enter");
        return owner;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          await rm(ownerPath, { force: true });
          throw error;
        }
      }
      const observed = await this.lockOwner(this.lockPath);
      if (observed) {
        await signal("lock-stale-observed");
        if ((await this.ownerLiveness(observed.pid, observed.startToken)) === "dead")
          await this.detachObservedLock(observed, deadline);
      }
      if (Date.now() >= deadline) {
        await rm(ownerPath, { force: true });
        throw new SkillCliError("LOCK_TIMEOUT", "State mutation lock is held");
      }
      await Bun.sleep(10);
    }
  }
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    if (StateCoordinator.lockContext.getStore() === this.root) return operation();
    await this.ensureRoot();
    const owner = await this.acquire();
    try {
      return await StateCoordinator.lockContext.run(this.root, async () => {
        await this.recover();
        return operation();
      });
    } finally {
      await this.removeOwnedLock(owner).catch(() => undefined);
      await rm(join(this.root, "locks", `owner-${owner.nonce}`), { force: true }).catch(
        () => undefined,
      );
    }
  }
  async read(): Promise<PrivateState> {
    await this.check(this.statePath, "file");
    const state = parseState(await readBytes(this.statePath));
    semanticStateReadHook?.();
    return state;
  }
  private async mutableDir(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await this.check(path, "directory", false);
  }
  private async writeSynced(path: string, value: Uint8Array | string) {
    await signal("write");
    await writeFile(path, value, { mode: 0o600 });
    await sync(path);
  }
  private async replace(target: string, stage: string) {
    if (target.startsWith(this.root)) await this.check(target, "file");
    await mkdir(dirname(target), { recursive: true });
    const adjacent = join(dirname(target), `.${crypto.randomUUID()}.stage`);
    await signal("write");
    await copyFile(stage, adjacent);
    await sync(adjacent);
    await signal(target === this.statePath ? "state-replace-before" : "rename-before");
    await rename(adjacent, target);
    await signal(target === this.statePath ? "state-replace-after" : "rename-after");
  }
  async stageTransaction(
    input: readonly { readonly target: string; readonly bytes: string | Uint8Array }[],
    status: Transaction["status"] = "committed",
    expectedState?: number,
  ): Promise<void> {
    const id = crypto.randomUUID();
    const stageRoot = join(this.root, "staging", id);
    const transactionRoot = join(this.root, "transactions");
    await this.mutableDir(stageRoot);
    await this.mutableDir(transactionRoot);
    const targets: TransactionTarget[] = [];
    for (const [index, target] of input.entries()) {
      const current = await readBytes(target.target);
      const stage = join(stageRoot, String(index));
      const bytes = typeof target.bytes === "string" ? Buffer.from(target.bytes) : target.bytes;
      await this.writeSynced(stage, bytes);
      targets.push({
        target: target.target,
        stage,
        exists: current !== undefined,
        old: current ? hash(current) : null,
        next: hash(bytes),
      });
    }
    const stateTarget = targets.find((target) => target.target === this.statePath);
    const current = stateTarget && parseState(await readBytes(this.statePath));
    const marker: Transaction = {
      status: "prepared",
      targets,
      ...(stateTarget
        ? {
            state: {
              target: this.statePath,
              expected: expectedState ?? current!.generation,
              next: parseState(await readBytes(stateTarget.stage)).generation,
            },
          }
        : {}),
    };
    const markerPath = join(transactionRoot, `${id}.json`);
    await signal("immutable-published");
    await signal("marker-prepared-before");
    await this.writeSynced(markerPath, JSON.stringify(marker));
    await signal("marker-prepared-after");
    if (status === "prepared") return;
    await signal("marker-committed-before");
    await this.writeSynced(markerPath, JSON.stringify({ ...marker, status: "committed" }));
    await signal("marker-committed-after");
  }
  async publish(
    targets: readonly { readonly target: string; readonly bytes: string | Uint8Array }[],
    expectedState?: number,
  ): Promise<void> {
    await this.stageTransaction(targets, "committed", expectedState);
    await this.recover();
  }
  async write(next: StateContents, expected: number): Promise<PrivateState> {
    const current = await this.read();
    if (current.generation !== expected)
      throw new SkillCliError("TRANSACTION_CONFLICT", "State generation changed");
    const installed = [...next.installed];
    if (!installed.every((item) => validateCurrentMaterialization(item)))
      throw new SkillCliError("CONFIG_INVALID", "Version 3 Installed Skill identity is invalid");
    const value = { ...next, installed, version: 3 as const, generation: expected + 1 };
    await this.publish([{ target: this.statePath, bytes: `${JSON.stringify(value)}\n` }], expected);
    return value;
  }
  /** Publishes caller-derived legacy evidence as the same state mutation, never as a read-side rewrite. */
  async migrateLegacy(
    current: PrivateState,
    installed: readonly InstalledMaterialization[],
  ): Promise<PrivateState> {
    if (current.version !== 1) return current;
    if (installed.length !== current.installed.length)
      throw new SkillCliError("CONFIG_INVALID", "Legacy Installed Skill migration is incomplete");
    return this.write({ installed, configs: current.configs }, current.generation);
  }
  async recover(): Promise<void> {
    const transactions = join(this.root, "transactions");
    await this.check(transactions, "directory");
    const markerNames = (await lstat(transactions).catch(() => undefined))?.isDirectory()
      ? await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: transactions }))
      : [];
    const markerIds = new Set(markerNames.map((name) => name.slice(0, -5)));
    const staging = join(this.root, "staging");
    await this.check(staging, "directory");
    if ((await lstat(staging).catch(() => undefined))?.isDirectory())
      for (const name of await readdir(staging)) {
        await this.check(join(staging, name), "directory", false);
        if (!markerIds.has(name)) await rm(join(staging, name), { recursive: true, force: true });
      }
    for (const name of markerNames) {
      const markerPath = join(transactions, name);
      await this.check(markerPath, "file", false);
      let marker: unknown;
      try {
        marker = JSON.parse(decodeStrictText((await readBytes(markerPath))!));
      } catch {
        throw new SkillCliError("TRANSACTION_CONFLICT", "Malformed transaction marker");
      }
      const id = name.slice(0, -5);
      const stageRoot = join(this.root, "staging", id);
      const declarationTarget = (target: string) =>
        ["config.jsonc", "skill-cli.jsonc", "skill-cli.local.jsonc"].includes(
          target.split(/[/\\]/u).at(-1) ?? "",
        ) && isAbsolute(target);
      const validTarget = (target: TransactionTarget, index: number) =>
        (target.target === this.statePath || declarationTarget(target.target)) &&
        target.stage === join(stageRoot, String(index)) &&
        target.exists === (target.old !== null);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id) ||
        !validateTransaction(marker) ||
        !marker.targets.every(validTarget) ||
        (marker.state !== undefined &&
          (!marker.targets.some((target) => target.target === this.statePath) ||
            marker.state.target !== this.statePath))
      )
        throw new SkillCliError("TRANSACTION_CONFLICT", "Malformed transaction marker");
      await this.check(stageRoot, "directory", false);
      for (const target of marker.targets) await this.check(target.stage, "file", false);
      const current = await Promise.all(
        marker.targets.map(async (target) => ({ target, bytes: await readBytes(target.target) })),
      );
      const state = marker.state && parseState(await readBytes(marker.state.target));
      if (
        marker.state &&
        (marker.state.next !== marker.state.expected + 1 ||
          (state!.generation !== marker.state.expected && state!.generation !== marker.state.next))
      )
        throw new SkillCliError("TRANSACTION_CONFLICT", "State generation changed");
      const allOld = current.every(({ target, bytes }) => same(bytes, target.old));
      const known = current.every(
        ({ target, bytes }) => same(bytes, target.old) || same(bytes, target.next),
      );
      if (!known) throw new SkillCliError("TRANSACTION_CONFLICT", "Transaction target was edited");
      if (marker.status === "prepared") {
        if (!allOld || (marker.state && state!.generation !== marker.state.expected))
          throw new SkillCliError(
            "TRANSACTION_CONFLICT",
            "Prepared transaction was partially published",
          );
        await rm(join(this.root, "staging", name.slice(0, -5)), { recursive: true, force: true });
        await rm(markerPath, { force: true });
        continue;
      }
      for (const { target, bytes } of current)
        if (same(bytes, target.old)) {
          const staged = await readBytes(target.stage);
          if (!staged || !same(staged, target.next))
            throw new SkillCliError("TRANSACTION_CONFLICT", "Transaction stage is unavailable");
          await this.replace(target.target, target.stage);
        }
      await rm(join(this.root, "staging", name.slice(0, -5)), { recursive: true, force: true });
      await rm(markerPath, { force: true });
    }
  }
  async installLocal(
    source: string,
    path: string,
    root: string,
  ): Promise<InstalledMaterialization> {
    return this.withLock(async () => {
      const text = decodeStrictText(await readFile(join(resolve(root), "SKILL.md")));
      const { name, description } = parseSkillMetadata(text);
      const current = await this.read();
      const item: InstalledMaterialization = {
        source,
        path,
        root: resolve(root),
        name,
        description,
        kind: "local",
        digest: hash(Buffer.from(text)),
        bindingDigest: bindingDigest({
          kind: "local",
          origin: dirname(resolve(root)),
          root: "",
          path: dirname(resolve(root)),
        }),
        // Fixture setup has no Source declaration capture, but must still create valid v2 bytes.
        identityEvidence: {
          status: "known",
          canonicalOrigin: dirname(resolve(root)),
          originRelativeSkillRoot: basename(resolve(root)),
        },
      };
      await this.write(
        {
          installed: [
            ...current.installed.filter(
              (candidate) => candidate.source !== source || candidate.path !== path,
            ),
            item,
          ],
          configs: current.configs,
        },
        current.generation,
      );
      return item;
    });
  }
  async uninstall(source: string, path: string): Promise<void> {
    await this.withLock(async () => {
      const current = await this.read();
      await this.write(
        {
          installed: current.installed.filter(
            (item) => item.source !== source || item.path !== path,
          ),
          configs: current.configs,
        },
        current.generation,
      );
    });
  }
  /** Test fixture setup only; production Remote identities are owned by management acquisition. */
  async installRemoteForTest(item: RemoteInstalledMaterialization): Promise<void> {
    await this.withLock(async () => {
      const state = await this.read();
      // Fixtures without a captured binding are deliberately unprovable, not healthy installs.
      const fixture = item.identityEvidence
        ? item
        : { ...item, identityEvidence: { status: "unavailable" as const } };
      await this.write(
        {
          installed: [
            ...state.installed.filter(
              (candidate) => candidate.source !== item.source || candidate.path !== item.path,
            ),
            fixture,
          ],
          configs: state.configs,
        },
        state.generation,
      );
    });
  }
  private snapshotRoot(digest: string) {
    return join(this.root, "snapshots", digest, "root");
  }
  private configPath(digest: string) {
    return join(this.root, "configs", digest, "config.jsonc");
  }
  private async completeRoot(root: string): Promise<string> {
    const hasher = new Bun.CryptoHasher("sha256");
    const safeLink = async (link: string): Promise<string> => {
      const target = await readlink(link);
      const resolved =
        target && !target.includes("\0") && !isAbsolute(target)
          ? resolve(dirname(link), target)
          : "";
      const stat =
        resolved && !relative(root, resolved).startsWith("..")
          ? await lstat(resolved).catch(() => undefined)
          : undefined;
      if (!stat || stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Snapshot contains an unsafe link");
      return target;
    };
    const visit = async (directory: string, path: string): Promise<void> => {
      const stat = await lstat(directory).catch(() => undefined);
      if (!stat?.isDirectory() || stat.isSymbolicLink())
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Snapshot root is incomplete");
      hasher.update(`directory\0${path}\0`);
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
      for (const entry of entries) {
        const child = join(directory, entry.name);
        const childStat = await lstat(child);
        const childPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.name === ".git")
          throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Snapshot contains a gitlink");
        if (childStat.isSymbolicLink()) {
          hasher.update(`symlink\0${childPath}\0${await safeLink(child)}\0`);
          continue;
        }
        if (!childStat.isFile() && !childStat.isDirectory())
          throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Snapshot contains an unsafe entry");
        if (childStat.isDirectory()) await visit(child, childPath);
        else {
          const bytes = await readBytes(child);
          if (!bytes)
            throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Snapshot entry is unavailable");
          hasher.update(
            `file\0${childPath}\0${childStat.mode & 0o111 ? 1 : 0}\0${bytes.byteLength}\0`,
          );
          hasher.update(bytes);
        }
      }
    };
    await visit(root, "");
    const skill = await readBytes(join(root, "SKILL.md"));
    if (!skill) throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Snapshot has no SKILL.md");
    decodeStrictText(skill);
    return hasher.digest("hex");
  }
  async snapshotDigest(root: string): Promise<string> {
    return this.completeRoot(resolve(root));
  }
  async publishSnapshot(digest: string, sourceRoot: string): Promise<void> {
    if (!digest || !/^[a-f0-9]{64}$/u.test(digest))
      throw new SkillCliError("INVALID_ARGUMENT", "Snapshot digest is invalid");
    await this.withLock(async () => {
      const sourceDigest = await this.completeRoot(resolve(sourceRoot));
      if (sourceDigest !== digest)
        throw new SkillCliError(
          "PROVIDER_INTEGRITY_FAILED",
          "Snapshot digest does not match content",
        );
      const destination = this.snapshotRoot(digest);
      const existing = await lstat(destination).catch(() => undefined);
      if (existing) {
        if ((await this.completeRoot(destination)) !== digest)
          throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Snapshot digest collision");
        return;
      }
      const stage = join(this.root, "staging", crypto.randomUUID(), "snapshot");
      await this.mutableDir(dirname(stage));
      await cp(sourceRoot, stage, { recursive: true, dereference: false, errorOnExist: true });
      if ((await this.completeRoot(stage)) !== digest)
        throw new SkillCliError(
          "PROVIDER_INTEGRITY_FAILED",
          "Snapshot digest does not match staged content",
        );
      await this.mutableDir(dirname(destination));
      await signal("immutable-published");
      await rename(stage, destination);
    });
  }
  async verifySnapshot(digest: string): Promise<string> {
    const root = this.snapshotRoot(digest);
    if ((await this.completeRoot(root)) !== digest)
      throw new SkillCliError(
        "PROVIDER_INTEGRITY_FAILED",
        "Snapshot digest does not match content",
      );
    return root;
  }
  async discardUnreferencedSnapshot(digest: string): Promise<void> {
    await this.withLock(async () => {
      const state = await this.read();
      if (state.installed.some((item) => item.kind === "remote" && item.digest === digest)) return;
      const snapshot = join(this.root, "snapshots", digest);
      await this.check(snapshot, "directory");
      await rm(snapshot, { recursive: true, force: true });
    });
  }
  async withRunRoot<T>(operation: (root: string) => Promise<T>): Promise<T> {
    const id = crypto.randomUUID();
    const directory = join(this.root, "runs", id);
    const root = join(directory, "root");
    await this.withLock(async () => {
      await this.mutableDir(join(this.root, "runs"));
      await this.mutableDir(root);
    });
    try {
      return await operation(root);
    } finally {
      await this.withLock(async () => {
        await this.check(directory, "directory", false);
        await rm(directory, { recursive: true, force: true });
      });
    }
  }
  async publishRemoteConfig(
    id: string,
    commit: string,
    bytes: Uint8Array,
    installed?: readonly InstalledMaterialization[],
  ): Promise<void> {
    if (!validateConfigIdentity({ id, commit }))
      throw new SkillCliError("INVALID_ARGUMENT", "Remote Config identity is invalid");
    decodeStrictText(bytes);
    const value = hash(bytes);
    const path = this.configPath(value);
    await this.withLock(async () => {
      await this.mutableDir(dirname(path));
      const current = await readBytes(path);
      if (current && !same(current, value))
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Config cache digest collision");
      if (!current) {
        await this.writeSynced(path, bytes);
        await signal("immutable-published");
      }
      const state = await this.read();
      await this.write(
        {
          installed: installed ?? state.installed,
          configs: { ...state.configs, [id]: { commit, digest: value } },
        },
        state.generation,
      );
    });
  }
  private async startToken(pid: number): Promise<string | undefined> {
    if (this.processTokens.startToken) return this.processTokens.startToken(pid);
    if ((this.processTokens.platform ?? process.platform) !== "linux") return undefined;
    try {
      return (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1]?.split(" ")[19];
    } catch {
      return undefined;
    }
  }
  private async ownerLiveness(
    pid: number,
    startToken?: string,
  ): Promise<"active" | "dead" | "unknown"> {
    const token = await this.startToken(pid);
    if (token && startToken) return token === startToken ? "active" : "dead";
    try {
      process.kill(pid, 0);
      return "unknown";
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "unknown";
    }
  }
  /** Caller holds the mutation lock through Snapshot verification and use publication. */
  private async createUse(digest: string): Promise<string> {
    const nonce = crypto.randomUUID();
    const use = join(this.root, "uses", `${nonce}.json`);
    await this.mutableDir(join(this.root, "uses"));
    const startToken = await this.startToken(process.pid);
    await this.writeSynced(
      use,
      JSON.stringify({ digest, pid: process.pid, ...(startToken ? { startToken } : {}), nonce }),
    );
    await signal("use-created");
    return use;
  }
  private async removeUse(use: string | undefined): Promise<void> {
    if (use)
      await this.withLock(async () => {
        await rm(use, { force: true }).catch(() => undefined);
      });
  }
  async withRemoteUse<T>(digest: string, operation: () => Promise<T>): Promise<T> {
    const use = await this.withLock(async () => {
      await signal("use-verify-before");
      await this.verifySnapshot(digest);
      return this.createUse(digest);
    });
    try {
      return await operation();
    } finally {
      await this.removeUse(use);
    }
  }
  async withInstalledRoot<T>(
    address: { readonly source: string; readonly path: string },
    operation: (value: {
      readonly item: InstalledMaterialization;
      readonly root: string;
    }) => Promise<T>,
  ): Promise<T> {
    let found: { readonly item: InstalledMaterialization; readonly root: string } | undefined;
    let use: string | undefined;
    await this.withLock(async () => {
      const state = await this.read();
      const item = state.installed.find(
        (candidate) => candidate.source === address.source && candidate.path === address.path,
      );
      if (!item) throw new SkillCliError("SKILL_NOT_FOUND", "Installed Skill not found");
      const root = item.kind === "remote" ? await this.verifySnapshot(item.digest) : item.root;
      const stat = await lstat(root).catch(() => undefined);
      if (!stat?.isDirectory() || stat.isSymbolicLink())
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Installed content is unavailable");
      if (item.kind === "remote") use = await this.createUse(item.digest);
      found = { item, root };
    });
    try {
      return await operation(found!);
    } finally {
      await this.removeUse(use);
    }
  }
  async gc(): Promise<void> {
    const tombstones: string[] = [];
    await this.withLock(async () => {
      const state = await this.read();
      const retainedSnapshots = new Set(
        state.installed.filter((item) => item.kind === "remote").map((item) => item.digest),
      );
      const retainedConfigs = new Set(Object.values(state.configs).map((item) => item.digest));
      const uses = join(this.root, "uses");
      const useNames = await readdir(uses).catch(() => []);
      const records: (SnapshotUse & { path: string })[] = [];
      // Parse all ownership records before deciding any content is collectible.
      // An unreadable record may protect any digest, so fail closed for this pass.
      for (const name of useNames)
        try {
          const bytes = await readBytes(join(uses, name));
          const record: unknown = JSON.parse(decodeStrictText(bytes!));
          if (!validateSnapshotUse(record)) return;
          records.push({
            path: join(uses, name),
            digest: record.digest,
            pid: record.pid,
            nonce: record.nonce,
            startToken: record.startToken,
          });
        } catch {
          return;
        }
      for (const record of records) {
        await this.check(record.path, "file", false);
        try {
          if ((await this.ownerLiveness(record.pid, record.startToken)) !== "dead")
            retainedSnapshots.add(record.digest);
        } catch {
          return;
        }
      }
      const trash = join(this.root, "trash");
      await this.mutableDir(trash);
      for (const name of await readdir(trash)) {
        const tombstone = join(trash, name);
        const stat = await lstat(tombstone).catch(() => undefined);
        if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
        try {
          const owner: unknown = JSON.parse(
            decodeStrictText((await readBytes(join(tombstone, "owner.json")))!),
          );
          if (!validateTombstoneOwner(owner)) continue;
          if ((await this.ownerLiveness(owner.pid, owner.startToken)) === "dead")
            tombstones.push(tombstone);
        } catch {
          /* Unknown tombstone ownership is retained. */
        }
      }
      const snapshots = join(this.root, "snapshots");
      for (const [base, retained] of [
        [snapshots, retainedSnapshots],
        [join(this.root, "configs"), retainedConfigs],
      ] as const) {
        for (const name of await readdir(base).catch(() => [])) {
          if (retained.has(name)) continue;
          const live = join(base, name);
          const stat = await lstat(live).catch(() => undefined);
          if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
          if (base === snapshots) {
            try {
              await this.completeRoot(join(live, "root"));
            } catch {
              continue;
            }
          } else {
            try {
              decodeStrictText((await readBytes(join(live, "config.jsonc")))!);
            } catch {
              continue;
            }
          }
          const tombstone = join(trash, crypto.randomUUID());
          await this.mutableDir(tombstone);
          const startToken = await this.startToken(process.pid);
          await this.writeSynced(
            join(tombstone, "owner.json"),
            JSON.stringify({
              pid: process.pid,
              ...(startToken ? { startToken } : {}),
              nonce: crypto.randomUUID(),
            }),
          );
          await rename(live, join(tombstone, "content"));
          await signal("trash-moved");
          tombstones.push(tombstone);
        }
      }
    });
    await Promise.all(tombstones.map((path) => rm(path, { recursive: true, force: true })));
  }
}
