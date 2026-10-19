import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CheckedUpdateObservation } from "./check-service";

export const UPDATE_CHECK_CACHE_TTL = 8 * 60 * 60 * 1_000;
/** Keep one additional TTL of labelled old context, never an unbounded history. */
export const UPDATE_CHECK_CACHE_RETENTION = UPDATE_CHECK_CACHE_TTL * 2;
const VERSION = 1;

export interface CachedUpdateCheck {
  readonly source: string;
  readonly baseline: string;
  readonly checkedAt: number;
  readonly observation: CheckedUpdateObservation;
}

interface CacheFile {
  readonly version: number;
  readonly entries: readonly CachedUpdateCheck[];
}

export interface UpdateCheckCache {
  read(): Promise<readonly CachedUpdateCheck[]>;
  write(entries: readonly CachedUpdateCheck[]): Promise<void>;
}

export const updateCheckCacheKey = (entry: Pick<CachedUpdateCheck, "source" | "baseline">) =>
  `${entry.source}\u0000${entry.baseline}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validEntry(value: unknown): value is CachedUpdateCheck {
  if (
    !isRecord(value) ||
    typeof value.source !== "string" ||
    typeof value.checkedAt !== "number" ||
    !Number.isFinite(value.checkedAt) ||
    typeof value.baseline !== "string"
  )
    return false;
  const observation = value.observation;
  return (
    isRecord(observation) &&
    observation.source === value.source &&
    (observation.kind === "local" || observation.kind === "git" || observation.kind === "github") &&
    observation.baseline === value.baseline &&
    (observation.exactRevision === undefined || typeof observation.exactRevision === "string") &&
    ["changed", "added", "removed", "unchanged"].every(
      (name) =>
        Array.isArray(observation[name]) &&
        observation[name].every(
          (candidate) =>
            isRecord(candidate) &&
            typeof candidate.path === "string" &&
            typeof candidate.name === "string" &&
            typeof candidate.description === "string",
        ),
    )
  );
}

export function updateCheckCachePath(environment = process.env): string {
  const root =
    environment.SKTUI_UPDATE_CACHE_DIR ||
    (environment.XDG_CACHE_HOME
      ? join(environment.XDG_CACHE_HOME, "skctl")
      : join(environment.HOME || ".", ".cache", "skctl"));
  return join(root, "update-checks-v1.json");
}

/** Disk storage is intentionally tiny and accepts only JSON-safe opaque baselines. */
export function createUpdateCheckCache(path = updateCheckCachePath()): UpdateCheckCache {
  const read = async (): Promise<readonly CachedUpdateCheck[]> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!isRecord(parsed) || parsed.version !== VERSION || !Array.isArray(parsed.entries))
        return [];
      return parsed.entries.filter(validEntry);
    } catch {
      return [];
    }
  };
  return {
    read,
    async write(entries) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await chmod(dirname(path), 0o700);
      // A baseline includes the complete Core installation/binding identity. Retain
      // distinct source+baseline records so separate project environments do not
      // evict each other merely because they share a Source id.
      const cutoff = Date.now() - UPDATE_CHECK_CACHE_RETENTION;
      const existing = await read();
      const merged = new Map(
        existing
          .filter((entry) => entry.checkedAt >= cutoff)
          .map((entry) => [updateCheckCacheKey(entry), entry]),
      );
      for (const entry of entries) {
        const key = updateCheckCacheKey(entry);
        const prior = merged.get(key);
        if (!prior || entry.checkedAt >= prior.checkedAt) merged.set(key, entry);
      }
      const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(
          temporary,
          JSON.stringify({ version: VERSION, entries: [...merged.values()] } satisfies CacheFile),
          {
            encoding: "utf8",
            mode: 0o600,
          },
        );
        await rename(temporary, path);
        await chmod(path, 0o600);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
  };
}

export function isFreshUpdateCheck(entry: CachedUpdateCheck, now = Date.now()) {
  return (
    Number.isFinite(entry.checkedAt) &&
    entry.checkedAt <= now &&
    now - entry.checkedAt < UPDATE_CHECK_CACHE_TTL
  );
}
