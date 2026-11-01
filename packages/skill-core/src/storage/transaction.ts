import { copyFile, lstat, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { SkctlError } from "../shared";
import { stateSchema, transactionSchema, type PrivateState, type Transaction } from "./schema";
import * as v from "valibot";
import {
  assertPath,
  ensureDirectory,
  readOptional,
  syncDirectory,
  writeAtomic,
  writeSynced,
} from "./files";

export const contentHash = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const matches = (bytes: Uint8Array | undefined, hash: string | null) =>
  (bytes ? contentHash(bytes) : null) === hash;
const conflict = (message: string): never => {
  throw new SkctlError("TRANSACTION_CONFLICT", message);
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseState(bytes?: Uint8Array): PrivateState {
  if (!bytes) return { version: 4, generation: 0, installed: [], configs: {} };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SkctlError("CONFIG_INVALID", "Invalid private state");
  }
  if (!v.is(stateSchema, value)) throw new SkctlError("CONFIG_INVALID", "Invalid private state");
  if (value.version === 4) return value;
  return {
    ...value,
    version: 4,
    installed: value.installed.map(({ digest, ...item }) => {
      const identityEvidence = item.identityEvidence ?? { status: "unavailable" as const };
      return item.kind === "remote"
        ? { ...item, identityEvidence, snapshotId: digest }
        : { ...item, identityEvidence };
    }),
  };
}

/** Bounded child-process fault injection; no callback or alternate publication path. */
async function checkpoint(phase: string) {
  if (process.env.SKCTL_TEST_BARRIER_AT === phase) {
    const release = process.env.SKCTL_TEST_BARRIER_RELEASE;
    if (!release) throw new Error("Barrier release path is required");
    while (!(await lstat(release).catch(() => undefined))) await Bun.sleep(10);
  }
  if (process.env.SKCTL_TEST_CRASH_AT === phase) process.exit(97);
}

async function readTarget(path: string) {
  await assertPath(path, "file", true);
  return readOptional(path);
}

/** Caller owns the mutation lock throughout staging, validation and recovery. */
export class Transactions {
  private readonly markers: string;
  private readonly staging: string;
  private readonly state: string;
  constructor(private readonly root: string) {
    this.markers = join(root, "transactions");
    this.staging = join(root, "staging");
    this.state = join(root, "state.json");
  }

  private validTarget(path: string) {
    return (
      isAbsolute(path) &&
      resolve(path) === path &&
      (path === this.state ||
        ["config.jsonc", "skctl.jsonc", "skctl.local.jsonc"].includes(basename(path)))
    );
  }

  async publish(
    input: readonly { readonly target: string; readonly bytes: string | Uint8Array }[],
    expected?: number,
    readSet: readonly { readonly path: string; readonly hash: string | null }[] = [],
  ) {
    if (
      !input.length ||
      new Set(input.map((item) => item.target)).size !== input.length ||
      input.some((item) => !this.validTarget(item.target))
    )
      throw new SkctlError("INVALID_ARGUMENT", "Invalid transaction targets");
    const id = crypto.randomUUID(),
      stageRoot = join(this.staging, id);
    await ensureDirectory(stageRoot);
    await ensureDirectory(this.markers);
    const marker: Transaction = { status: "prepared", targets: [] };
    let published = false;
    try {
      const validateReadSet = async () => {
        for (const item of readSet)
          if (!matches(await readTarget(item.path), item.hash))
            conflict("Captured transaction input changed");
      };
      await validateReadSet();
      for (const [index, item] of input.entries()) {
        const old = await readTarget(item.target),
          stage = join(stageRoot, String(index));
        const bytes = typeof item.bytes === "string" ? Buffer.from(item.bytes) : item.bytes;
        await writeSynced(stage, bytes, true);
        marker.targets.push({
          target: item.target,
          stage,
          exists: old !== undefined,
          old: old ? contentHash(old) : null,
          next: contentHash(bytes),
        });
        if (item.target === this.state) {
          const current = parseState(old),
            next = parseState(bytes);
          if (
            (expected !== undefined && current.generation !== expected) ||
            next.generation !== current.generation + 1
          )
            conflict("State generation changed");
          marker.state = {
            target: this.state,
            expected: current.generation,
            next: next.generation,
          };
        }
      }
      await syncDirectory(stageRoot);
      // Stages do not authorize replacement. Revalidate before giving the marker authority.
      for (const target of marker.targets)
        if (!matches(await readTarget(target.target), target.old))
          conflict("Transaction target changed while staging");
      await validateReadSet();
      const path = join(this.markers, `${id}.json`);
      await writeAtomic(path, JSON.stringify(marker));
      await syncDirectory(this.markers);
      published = true;
      await checkpoint("transaction-prepared");
      await writeAtomic(path, JSON.stringify({ ...marker, status: "committed" }));
      await syncDirectory(this.markers);
      await checkpoint("transaction-committed");
      await this.recover();
    } finally {
      if (!published) await rm(stageRoot, { recursive: true, force: true });
    }
  }

  async recover() {
    await assertPath(this.markers, "directory", true);
    await assertPath(this.staging, "directory", true);
    const list = (path: string) =>
      readdir(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    const names = (await list(this.markers)).filter((name) => name.endsWith(".json")).sort();
    const ids = new Set(names.map((name) => name.slice(0, -5)));
    for (const name of await list(this.staging)) {
      const path = join(this.staging, name);
      await assertPath(path, "directory");
      if (!ids.has(name)) await rm(path, { recursive: true });
    }
    for (const name of names) await this.recoverTransaction(name);
  }

  private async replace(target: Transaction["targets"][number]) {
    await ensureDirectory(dirname(target.target));
    const adjacent = join(dirname(target.target), `.${crypto.randomUUID()}.stage`);
    try {
      await copyFile(target.stage, adjacent);
      const file = await open(adjacent, "r");
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      if (!matches(await readTarget(target.target), target.old))
        conflict("Transaction target changed before replacement");
      await rename(adjacent, target.target);
      await syncDirectory(dirname(target.target));
      await checkpoint(
        target.target === this.state ? "transaction-state-replaced" : "transaction-config-replaced",
      );
    } finally {
      await rm(adjacent, { force: true });
    }
  }

  private async recoverTransaction(name: string) {
    const id = name.slice(0, -5),
      path = join(this.markers, name),
      stageRoot = join(this.staging, id);
    let value: unknown;
    try {
      value = JSON.parse((await readTarget(path))!.toString());
    } catch {
      conflict("Malformed transaction marker");
    }
    if (!uuid.test(id) || !v.is(transactionSchema, value))
      return conflict("Malformed transaction marker");
    const marker = value;
    const stateTarget = marker.targets.find((item) => item.target === this.state);
    if (
      !marker.targets.length ||
      new Set(marker.targets.map((item) => item.target)).size !== marker.targets.length ||
      !marker.targets.every(
        (item, index) =>
          this.validTarget(item.target) &&
          item.stage === join(stageRoot, String(index)) &&
          item.exists === (item.old !== null),
      ) ||
      Boolean(stateTarget) !== Boolean(marker.state) ||
      (marker.state && marker.state.target !== this.state)
    )
      conflict("Malformed transaction targets");
    await assertPath(stageRoot, "directory");
    // Validate all stages and targets before replacing any one of them.
    const targets = [];
    for (const target of marker.targets) {
      const staged = await readTarget(target.stage),
        current = await readTarget(target.target);
      if (!staged || !matches(staged, target.next)) conflict("Transaction stage is unavailable");
      if (!matches(current, target.old) && !matches(current, target.next))
        conflict("Transaction target was edited");
      targets.push({ target, current });
    }
    if (marker.state) {
      const current = parseState(await readTarget(this.state));
      const staged = parseState(await readTarget(stateTarget!.stage));
      if (
        marker.state.next !== marker.state.expected + 1 ||
        staged.generation !== marker.state.next ||
        ![marker.state.expected, marker.state.next].includes(current.generation)
      )
        conflict("State generation changed");
    }
    if (marker.status === "prepared") {
      if (
        !targets.every(({ target, current }) => matches(current, target.old)) ||
        (marker.state &&
          parseState(await readTarget(this.state)).generation !== marker.state.expected)
      )
        conflict("Prepared transaction was partially published");
    } else {
      for (const { target, current } of targets)
        if (!matches(current, target.next)) await this.replace(target);
      for (const { target } of targets)
        if (!matches(await readTarget(target.target), target.next))
          conflict("Transaction publication failed verification");
    }
    // Removing the marker first makes a crash here an orphan-stage cleanup, not an incomplete recovery.
    await rm(path);
    await syncDirectory(this.markers);
    await rm(stageRoot, { recursive: true });
  }
}
