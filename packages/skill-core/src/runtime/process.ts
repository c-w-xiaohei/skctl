import { readFile, readdir } from "node:fs/promises";
import { SkctlError } from "../shared";
import * as v from "valibot";

export const processIdentitySchema = v.object({
  pid: v.pipe(v.number(), v.integer(), v.minValue(1)),
  startToken: v.optional(v.string()),
});
export type ProcessIdentity = Readonly<v.InferOutput<typeof processIdentitySchema>>;

export async function processIdentity(pid = process.pid): Promise<ProcessIdentity> {
  if (process.platform !== "linux") return { pid };
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return { pid, startToken: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] };
  } catch {
    return { pid };
  }
}

export async function processStatus(
  owner: ProcessIdentity,
): Promise<"active" | "dead" | "unknown"> {
  const current = await processIdentity(owner.pid);
  if (owner.startToken && current.startToken)
    return owner.startToken === current.startToken ? "active" : "dead";
  try {
    process.kill(owner.pid, 0);
    return "unknown";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "unknown";
  }
}

export interface ProcessRequest {
  readonly cmd: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly input?: Uint8Array;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}

/** Owns the child group and both pipe drains until completion or verified cancellation. */
export async function runProcess(request: ProcessRequest) {
  const { signal } = request;
  if (signal?.aborted) throw new SkctlError("CANCELLED", "Process cancelled");
  const child = Bun.spawn([...request.cmd], {
    cwd: request.cwd,
    env: request.env ?? process.env,
    stdin: request.input ? request.input : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  });
  let stopping: Promise<void> | undefined;
  const groupSignal = (value: NodeJS.Signals) => {
    try {
      process.kill(-child.pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const stop = () => {
    stopping ??= (async () => {
      if (process.platform === "win32") {
        const killer = Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
          stdout: "ignore",
          stderr: "ignore",
        });
        if (await killer.exited)
          throw new SkctlError("CLEANUP_FAILED", "Child tree cleanup failed");
        return;
      }
      groupSignal("SIGTERM");
      await Bun.sleep(250);
      groupSignal("SIGKILL");
      const deadline = Date.now() + 1_000;
      while (await hasLiveGroup(child.pid)) {
        if (Date.now() >= deadline)
          throw new SkctlError("CLEANUP_FAILED", "Owned process group did not stop");
        await Bun.sleep(10);
      }
    })();
    // Pipe readers can fail before the caller awaits the cleanup promise.
    void stopping.catch(() => {});
  };
  const drain = async (stream: ReadableStream<Uint8Array>, limit: number, bounded: boolean) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const bytes of stream) {
        if (bounded && bytes.length > limit - size)
          throw new SkctlError("TEXT_TOO_LARGE", "Process output exceeds its limit");
        const kept = bytes.subarray(0, Math.max(0, limit - size));
        if (kept.length) chunks.push(kept);
        size += kept.length;
      }
      return Buffer.concat(chunks);
    } catch (error) {
      stop();
      if (error instanceof SkctlError) throw error;
      throw new SkctlError(
        "CLEANUP_FAILED",
        `Process pipe drain failed: ${error instanceof Error ? error.message : "Read failed"}`,
      );
    }
  };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  try {
    const results = await Promise.allSettled([
      child.exited,
      drain(child.stdout, request.maxOutputBytes ?? 64 * 1024 * 1024, true),
      drain(child.stderr, 64 * 1024, false),
    ]);
    await stopping;
    const [status, stdout, stderr] = results;
    if (status.status === "rejected") throw status.reason;
    if (stdout.status === "rejected") throw stdout.reason;
    if (stderr.status === "rejected") throw stderr.reason;
    if (signal?.aborted) throw new SkctlError("CANCELLED", "Process cancelled");
    return { status: status.value, stdout: stdout.value, stderr: stderr.value };
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

async function hasLiveGroup(group: number): Promise<boolean> {
  if (process.platform !== "linux") {
    try {
      process.kill(-group, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  }
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const stat = await readFile(`/proc/${name}/stat`, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(fields[2]) === group && !["Z", "X"].includes(fields[0]!)) return true;
  }
  return false;
}
