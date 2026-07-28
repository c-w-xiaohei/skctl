import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute, join, resolve, win32 } from "node:path";

export interface CatalogEntry {
  readonly selector: string;
  readonly aliases: readonly string[];
  readonly name: string;
  readonly description: string;
  readonly loadingOwner: "skill-cli";
  readonly provenance: {
    readonly source: string;
    readonly origin: "local" | "git";
    readonly declaration: { readonly layer: string };
    readonly stability: "mutable-local" | "immutable";
    readonly revision?: string;
  };
}

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

function validEntry(value: unknown): value is CatalogEntry {
  if (
    !isObject(value) ||
    !validSelector(value.selector) ||
    !Array.isArray(value.aliases) ||
    !value.aliases.every(validSelector) ||
    !validText(value.name) ||
    !validText(value.description) ||
    value.loadingOwner !== "skill-cli"
  )
    return false;
  const provenance = value.provenance;
  const validProvenance =
    isObject(provenance) &&
    hasExactKeys(
      provenance,
      provenance.origin === "git"
        ? ["declaration", "origin", "revision", "source", "stability"]
        : ["declaration", "origin", "source", "stability"],
    ) &&
    validName(provenance.source, true) &&
    isObject(provenance.declaration) &&
    hasExactKeys(provenance.declaration, ["layer"]) &&
    validName(provenance.declaration.layer, true) &&
    ((provenance.origin === "local" &&
      provenance.stability === "mutable-local" &&
      provenance.revision === undefined) ||
      (provenance.origin === "git" &&
        provenance.stability === "immutable" &&
        validText(provenance.revision)));
  return (
    hasExactKeys(value, [
      "aliases",
      "description",
      "loadingOwner",
      "name",
      "provenance",
      "selector",
    ]) && validProvenance
  );
}

function sortedDistinctAliases(entry: CatalogEntry): boolean {
  let previous = entry.selector;
  for (const alias of entry.aliases) {
    if (alias <= previous) return false;
    previous = alias;
  }
  return true;
}

function validDiagnostic(value: unknown): boolean {
  if (!isObject(value) || !validText(value.code) || !validText(value.message)) return false;
  if (value.severity !== "info" && value.severity !== "warning") return false;
  if (value.location !== undefined) {
    if (!isObject(value.location) || !validText(value.location.file)) return false;
    if (value.location.pointer !== undefined && !validText(value.location.pointer)) return false;
    if (
      !hasExactKeys(
        value.location,
        value.location.pointer === undefined ? ["file"] : ["file", "pointer"],
      )
    )
      return false;
  }
  if (value.related !== undefined) {
    if (!Array.isArray(value.related)) return false;
    for (const related of value.related) {
      if (!isObject(related) || !validText(related.message)) return false;
      if (related.file !== undefined && !validText(related.file)) return false;
      if (related.pointer !== undefined && !validText(related.pointer)) return false;
      const keys = [
        "message",
        ...(related.file === undefined ? [] : ["file"]),
        ...(related.pointer === undefined ? [] : ["pointer"]),
      ].sort();
      if (!hasExactKeys(related, keys)) return false;
    }
  }
  if (value.suggestion !== undefined && !validText(value.suggestion)) return false;
  const keys = [
    "code",
    "message",
    "severity",
    ...(value.location === undefined ? [] : ["location"]),
    ...(value.related === undefined ? [] : ["related"]),
    ...(value.suggestion === undefined ? [] : ["suggestion"]),
  ].sort();
  return hasExactKeys(value, keys);
}

type CatalogEnvelope =
  | { readonly type: "success"; readonly entries: readonly CatalogEntry[] }
  | { readonly type: "unavailable" }
  | { readonly type: "error" };

function parseCatalog(
  stdout: Uint8Array,
  hostVersion: string,
  status: number | null,
): CatalogEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(text(stdout));
  } catch {
    throw new AdapterProcessError("PROTOCOL");
  }
  if (isObject(value) && value.protocolVersion === 1 && value.operation === "list") {
    if (
      value.type === "unavailable" &&
      isObject(value.unavailable) &&
      hasExactKeys(value, ["operation", "protocolVersion", "type", "unavailable"]) &&
      hasExactKeys(value.unavailable, ["reason"]) &&
      validText(value.unavailable.reason) &&
      status === 0
    )
      return { type: "unavailable" };
    if (
      value.type === "error" &&
      isObject(value.error) &&
      hasExactKeys(value, ["error", "operation", "protocolVersion", "type"]) &&
      hasExactKeys(value.error, ["code", "diagnostics", "message"]) &&
      validText(value.error.code) &&
      validText(value.error.message) &&
      Array.isArray(value.error.diagnostics) &&
      value.error.diagnostics.every(validDiagnostic) &&
      status === 1
    )
      return { type: "error" };
  }
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["ok", "operation", "protocolVersion", "result"]) ||
    value.protocolVersion !== 1 ||
    value.ok !== true ||
    value.operation !== "list" ||
    !isObject(value.result) ||
    !hasExactKeys(value.result, ["agent", "entries", "mode"]) ||
    !isObject(value.result.agent) ||
    !hasExactKeys(value.result.agent, ["id", "version"]) ||
    value.result.agent.id !== "opencode" ||
    value.result.agent.version !== hostVersion ||
    value.result.mode !== "managed" ||
    !Array.isArray(value.result.entries) ||
    !value.result.entries.every(validEntry) ||
    status !== 0
  )
    throw new AdapterProcessError("PROTOCOL");
  const selectors = new Set<string>();
  const identities = new Set<string>();
  for (const entry of value.result.entries) {
    if (!sortedDistinctAliases(entry)) throw new AdapterProcessError("PROTOCOL");
    for (const selector of [entry.selector, ...entry.aliases]) {
      if (selectors.has(selector)) throw new AdapterProcessError("PROTOCOL");
      selectors.add(selector);
    }
    const { provenance } = entry;
    const identity = `${provenance.source}\0${entry.name}\0${provenance.origin}\0${provenance.revision ?? ""}`;
    if (identities.has(identity)) throw new AdapterProcessError("PROTOCOL");
    identities.add(identity);
  }
  return { type: "success", entries: value.result.entries };
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
    async list(cwd: string): Promise<readonly CatalogEntry[]> {
      const executable = await skillCli;
      if (!executable) throw new AdapterProcessError("SKILL_CLI_NOT_FOUND");
      const detectedVersion = await version();
      const result = await execute(
        runner,
        [executable, "agent", "list", "--json", "--protocol", "1"],
        {
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
        },
      );
      const envelope = parseCatalog(result.stdout, detectedVersion, result.status);
      if (envelope.type === "unavailable") throw new AdapterProcessError("CATALOG_UNAVAILABLE");
      if (envelope.type === "error")
        throw new AdapterProcessError("CATALOG_ERROR", result.status, text(result.stderr));
      return envelope.entries;
    },
  };
}
