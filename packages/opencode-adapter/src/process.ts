import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute, join, resolve, win32 } from "node:path";

export type CatalogItem =
  | {
      readonly kind: "collection";
      readonly id: string;
      readonly name: string;
      readonly description?: string;
    }
  | {
      readonly kind: "skill";
      readonly selector: string;
      readonly name: string;
      readonly description: string;
    };
export type CatalogScope =
  | { readonly kind: "root" }
  | { readonly kind: "collection"; readonly id: string };

export interface ChildProcess {
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number | null>;
  kill(signal?: NodeJS.Signals): void;
}

export interface ProcessRunner {
  spawn(
    argv: readonly string[],
    options: { cwd?: string; env: Record<string, string | undefined> },
  ): ChildProcess;
}

export class AdapterProcessError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number | null,
    readonly stderr = "",
    readonly hostProbe = false,
  ) {
    super(code);
  }
}

export interface ProcessClientOptions {
  readonly path?: string;
  readonly env?: Record<string, string | undefined>;
  readonly exists?: (path: string) => boolean | Promise<boolean>;
  readonly runner?: ProcessRunner;
  readonly timeoutMs?: number;
  readonly stdoutLimit?: number;
  readonly stderrLimit?: number;
  /** Internal deterministic lifecycle test controls. */
  readonly terminationGraceMs?: number;
  readonly cleanupTimeoutMs?: number;
  /** Internal deterministic cross-host test controls. */
  readonly platform?: "posix" | "win32";
  readonly pathExt?: string;
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const candidateHost = "1.18.4";

function defaultRunner(): ProcessRunner {
  return {
    spawn(argv, options) {
      const child = Bun.spawn([...argv], {
        cwd: options.cwd,
        env: options.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        stdout: child.stdout,
        stderr: child.stderr,
        exited: child.exited,
        kill: (signal) => child.kill(signal),
      };
    },
  };
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveFromPath(
  name: string,
  path: string,
  exists: ProcessClientOptions["exists"],
  platform: "posix" | "win32",
  pathExt: string,
): Promise<string | undefined> {
  const pathApi = platform === "win32" ? win32 : { isAbsolute, join, resolve };
  const extensions = platform === "win32" ? ["", ...pathExt.split(";").filter(Boolean)] : [""];
  if (pathApi.isAbsolute(name)) {
    for (const extension of extensions) {
      const candidate = `${name}${extension}`;
      if (await (exists ?? defaultExists)(candidate)) return candidate;
    }
    return undefined;
  }
  for (const directory of path.split(platform === "win32" ? ";" : ":").filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = pathApi.join(
        pathApi.isAbsolute(directory) ? directory : pathApi.resolve(directory),
        `${name}${extension}`,
      );
      if (await (exists ?? defaultExists)(candidate)) return candidate;
    }
  }
  return undefined;
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  onOverflow: () => void,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (stream === null) return new Uint8Array();
  const reader = stream.getReader();
  const cancel = () => void reader.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        onOverflow();
        await reader.cancel();
        throw new AdapterProcessError("OUTPUT_OVERFLOW");
      }
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function execute(
  runner: ProcessRunner,
  argv: readonly string[],
  options: {
    cwd?: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
    stdoutLimit: number;
    stderrLimit: number;
    terminationGraceMs: number;
    cleanupTimeoutMs: number;
  },
): Promise<{ stdout: Uint8Array; stderr: Uint8Array; status: number | null }> {
  let child: ChildProcess;
  try {
    child = runner.spawn(argv, options);
  } catch {
    throw new AdapterProcessError("SPAWN_FAILED");
  }
  const controller = new AbortController();
  let terminated = false;
  const kill = (signal: NodeJS.Signals) => {
    try {
      child.kill(signal);
    } catch {}
  };
  const terminate = () => {
    if (terminated) return;
    terminated = true;
    controller.abort();
    kill("SIGTERM");
  };
  let exited = false;
  const exit = child.exited.finally(() => {
    exited = true;
  });
  let stdout: Promise<Uint8Array> | undefined;
  let stderr: Promise<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    stdout = readBounded(child.stdout, options.stdoutLimit, terminate, controller.signal);
    stderr = readBounded(child.stderr, options.stderrLimit, terminate, controller.signal);
    const completed = Promise.all([stdout, stderr, exit]);
    const result = await Promise.race([
      completed,
      new Promise<never>(
        (_, reject) =>
          (timer = setTimeout(() => reject(new AdapterProcessError("TIMEOUT")), options.timeoutMs)),
      ),
    ]);
    return { stdout: result[0], stderr: result[1], status: result[2] };
  } catch (error) {
    terminate();
    await Promise.race([
      exit.catch(() => null),
      new Promise((resolve) => setTimeout(resolve, options.terminationGraceMs)),
    ]);
    if (!exited) kill("SIGKILL");
    const joined = await Promise.race([
      Promise.allSettled([exit, stdout, stderr].filter(Boolean)),
      new Promise<undefined>((resolve) => setTimeout(resolve, options.cleanupTimeoutMs)),
    ]);
    if (joined === undefined) throw new AdapterProcessError("CLEANUP_FAILED");
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function text(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new AdapterProcessError("PROTOCOL");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function validSelector(value: unknown): value is string {
  if (typeof value !== "string" || (value.match(/:/g) ?? []).length !== 1) return false;
  const [collection, name] = value.split(":");
  return validName(collection, true) && validName(name, false);
}

function validName(value: unknown, qualified: boolean): value is string {
  if (typeof value !== "string" || !value) return false;
  const segments = qualified ? value.split("/") : [value];
  return segments.every(
    (segment) =>
      !!segment &&
      Buffer.byteLength(segment) <= 128 &&
      segment === segment.normalize("NFC") &&
      segment !== "." &&
      segment !== ".." &&
      ![...segment].some(
        (character) =>
          /\s/u.test(character) ||
          character.codePointAt(0)! < 32 ||
          character.codePointAt(0) === 127 ||
          ":\\/#".includes(character),
      ),
  );
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 1_048_576;
}

function validItem(value: unknown): value is CatalogItem {
  if (!isObject(value) || !validText(value.name)) return false;
  if (value.kind === "skill")
    return (
      validSelector(value.selector) &&
      validText(value.description) &&
      hasExactKeys(value, ["description", "kind", "name", "selector"])
    );
  return (
    value.kind === "collection" &&
    validName(value.id, true) &&
    (value.description === undefined || validText(value.description)) &&
    hasExactKeys(
      value,
      value.description === undefined
        ? ["id", "kind", "name"]
        : ["description", "id", "kind", "name"],
    )
  );
}

type CatalogEnvelope =
  | {
      readonly type: "success";
      readonly scope: CatalogScope;
      readonly items: readonly CatalogItem[];
    }
  | { readonly type: "unavailable" }
  | { readonly type: "error" };

function parseCatalog(stdout: Uint8Array, status: number | null): CatalogEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(text(stdout));
  } catch {
    throw new AdapterProcessError("PROTOCOL");
  }
  if (
    isObject(value) &&
    hasExactKeys(value, ["unavailable"]) &&
    value.unavailable === true &&
    status === 0
  )
    return { type: "unavailable" };
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["items", "scope"]) ||
    !Array.isArray(value.items) ||
    !value.items.every(validItem) ||
    !isObject(value.scope) ||
    !(
      (value.scope.kind === "root" && hasExactKeys(value.scope, ["kind"])) ||
      (value.scope.kind === "collection" &&
        validName(value.scope.id, true) &&
        hasExactKeys(value.scope, ["id", "kind"]))
    ) ||
    status !== 0
  )
    throw new AdapterProcessError("PROTOCOL");
  if (value.scope.kind !== "root" || value.items.some((item) => item.kind !== "collection"))
    throw new AdapterProcessError("PROTOCOL");
  return {
    type: "success",
    scope: value.scope as CatalogScope,
    items: value.items as CatalogItem[],
  };
}

const diagnosticLimit = 4096;
const truncatedMarker = " [truncated]";

function truncateDiagnostic(value: string, limit: number): string {
  if (Buffer.byteLength(value) <= limit) return value;
  const contentLimit = limit - Buffer.byteLength(truncatedMarker);
  let output = "";
  let length = 0;
  for (const character of value) {
    const characterLength = Buffer.byteLength(character);
    if (length + characterLength > contentLimit) break;
    output += character;
    length += characterLength;
  }
  return `${output}${truncatedMarker}`;
}

export function redactDiagnostic(value: string, limit = diagnosticLimit): string {
  const redacted = value
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(
      /"(?:[a-z]:[\\/][^"\r\n]*?[\\/]appdata[\\/]local[\\/]temp|%(?:temp|tmp)%)[\\/][^"\r\n]*"/gi,
      '"[temp]"',
    )
    .replace(
      /(?:[a-z]:[\\/][^\r\n;]*?[\\/]appdata[\\/]local[\\/]temp|%(?:temp|tmp)%)[\\/][^\r\n;]*?(?=\s+[a-z][\w-]*=|;|$)/gi,
      "[temp]",
    )
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[redacted]@")
    .replace(/\bbearer\s+[^\s]+/gi, "[redacted]")
    .replace(
      /\b(?:authorization|token|api[-_]?key|cookie|set-cookie)\s*[:=]\s*[^\s]+/gi,
      "[redacted]",
    )
    .replace(/\b\w+\s*=\s*(?:bearer\s+)?[^\s]+/gi, "[redacted]")
    .replace(/(?:\/tmp\/|\/var\/folders\/)[^\s]+/g, "[temp]");
  return truncateDiagnostic(redacted, limit);
}

export function createProcessClient(options: ProcessClientOptions = {}) {
  const env = { ...process.env, ...options.env };
  const path = options.path ?? env.PATH ?? "";
  const runner = options.runner ?? defaultRunner();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const stdoutLimit = options.stdoutLimit ?? 1_048_576;
  const stderrLimit = options.stderrLimit ?? 65_536;
  const terminationGraceMs = options.terminationGraceMs ?? 100;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 100;
  const platform = options.platform ?? (process.platform === "win32" ? "win32" : "posix");
  const pathExt = options.pathExt ?? env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const skillCli = resolveFromPath("skill-cli", path, options.exists, platform, pathExt);
  const host = resolveFromPath("opencode", path, options.exists, platform, pathExt);
  let hostVersion: Promise<string> | undefined;

  async function version(): Promise<string> {
    if (!hostVersion)
      hostVersion = (async () => {
        try {
          const executable = await host;
          if (!executable) throw new AdapterProcessError("HOST_NOT_FOUND");
          const result = await execute(runner, [executable, "--version"], {
            env,
            timeoutMs: 1_000,
            stdoutLimit: 4_096,
            stderrLimit: 4_096,
            terminationGraceMs,
            cleanupTimeoutMs,
          });
          if (result.status !== 0)
            throw new AdapterProcessError("HOST_VERSION", result.status, text(result.stderr));
          const output = text(result.stdout);
          if (
            !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\n?$/.test(output) ||
            output.trim() !== candidateHost
          )
            throw new AdapterProcessError("HOST_VERSION", result.status, text(result.stderr));
          return output.trim();
        } catch (error) {
          if (error instanceof AdapterProcessError)
            throw new AdapterProcessError(error.code, error.status, error.stderr, true);
          throw new AdapterProcessError("HOST_VERSION", undefined, "", true);
        }
      })();
    return hostVersion;
  }

  return {
    async browse(cwd: string): Promise<{
      readonly scope: CatalogScope;
      readonly items: readonly CatalogItem[];
    }> {
      const executable = await skillCli;
      if (!executable) throw new AdapterProcessError("SKILL_CLI_NOT_FOUND");
      const detectedVersion = await version();
      const result = await execute(runner, [executable, "agent", "browse"], {
        cwd,
        env: {
          ...env,
          SKILL_CLI_AGENT: "opencode",
          SKILL_CLI_AGENT_VERSION: detectedVersion,
          NO_COLOR: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        timeoutMs,
        stdoutLimit,
        stderrLimit,
        terminationGraceMs,
        cleanupTimeoutMs,
      });
      const envelope = parseCatalog(result.stdout, result.status);
      if (envelope.type === "unavailable") throw new AdapterProcessError("CATALOG_UNAVAILABLE");
      if (envelope.type === "error")
        throw new AdapterProcessError("CATALOG_ERROR", result.status, text(result.stderr));
      return { scope: envelope.scope, items: envelope.items };
    },
  };
}
