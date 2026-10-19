import { SkctlError } from "../shared";
import type { ConfigDocument } from "../config/schema";

export type SourceNetwork = Readonly<NonNullable<ConfigDocument["network"]>>;
export const sourceCheckBudgetMs = 30_000;
export const sourceContentBudgetMs = 120_000;

/** One frozen remote-preparation lifetime; providers/fallbacks reuse, never renew it. */
export interface SourceOperation extends SourceNetwork {
  readonly source: string;
  readonly signal: AbortSignal;
  readonly expiresAt: number;
  readonly throwIfAborted: (phase: string) => void;
  readonly dispose: () => void;
}
export function createSourceOperation(
  input: SourceNetwork & {
    readonly source: string;
    readonly signal?: AbortSignal;
    readonly budgetMs?: number;
  },
): SourceOperation {
  const budgetMs = input.budgetMs ?? sourceContentBudgetMs;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0)
    throw new SkctlError("INVALID_ARGUMENT", "Source operation budget must be positive");
  const controller = new AbortController();
  const callerSignal = input.signal;
  const expiresAt = Date.now() + budgetMs;
  const timeoutReason = Symbol("source deadline");
  const cancel = () => controller.abort(); // Never retain a caller's potentially secret reason.
  if (callerSignal?.aborted) cancel();
  else callerSignal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutReason), budgetMs);
  let disposed = false;
  const operation: SourceOperation = Object.freeze({
    source: input.source,
    ...(input.proxy === undefined ? {} : { proxy: input.proxy }),
    signal: controller.signal,
    expiresAt,
    throwIfAborted(phase: string) {
      if (!disposed && Date.now() >= expiresAt && !controller.signal.aborted)
        controller.abort(timeoutReason);
      if (!controller.signal.aborted) return;
      const timeout = controller.signal.reason === timeoutReason;
      throw sourceNetworkError(
        operation,
        phase,
        timeout ? "Remote preparation deadline exceeded" : "Operation cancelled",
        timeout ? "PROVIDER_TIMEOUT" : "CANCELLED",
      );
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", cancel);
    },
  });
  return operation;
}

/** Actual Bun fetch-only proxy option; also suitable for Octokit's request.fetch. */
export function sourceFetch(
  operation: SourceOperation,
): (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response> {
  return (input, init) => {
    operation.throwIfAborted("HTTP");
    if (operation.proxy !== undefined && !Bun.semver.satisfies(Bun.version, ">=1.4.3"))
      throw sourceNetworkError(
        operation,
        "HTTP",
        "Explicit source proxy requires Bun 1.4.3 or newer; use the current native release or run source with a supported Bun runtime",
      );
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return fetch(input, {
      ...init,
      signal: requestSignal ? AbortSignal.any([operation.signal, requestSignal]) : operation.signal,
      ...(operation.proxy === undefined
        ? {}
        : { proxy: { url: operation.proxy, respectNoProxy: false } }),
    });
  };
}

export function sourceChildEnv(
  operation: SourceNetwork,
  inherited: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const env = { ...inherited };
  if (operation.proxy !== undefined) {
    for (const key of [
      "HTTP_PROXY",
      "http_proxy",
      "HTTPS_PROXY",
      "https_proxy",
      "ALL_PROXY",
      "all_proxy",
    ])
      env[key] = operation.proxy;
    env.NO_PROXY = "";
    env.no_proxy = "";
  }
  return env;
}

/** Append after inherited command config. Provider supplies effective locally-read proxy keys. */
export function sourceProxyConfigArgs(
  operation: SourceNetwork,
  target: string,
  effectiveKeys: readonly string[],
): string[] {
  if (operation.proxy === undefined) return [];
  const keys = new Set([
    "http.proxy",
    ...effectiveKeys.filter(
      (key) => /^http(?:\..+)?\.proxy$/iu.test(key) || /^remote\..+\.proxy$/iu.test(key),
    ),
    `http.${target}.proxy`,
  ]);
  return [...keys].flatMap((key) => ["-c", `${key}=${operation.proxy}`]);
}

function sanitized(value: string, secrets: readonly string[]): string {
  let text = value;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
    text = text.replaceAll(secret, "[redacted]");
  return (
    text
      .replace(/(https?:\/\/)[^\s/]*@/giu, "$1[redacted]@")
      // Quoted values consume escaped characters, never stop at an escaped quote.
      .replace(
        /(["'](?:proxy-)?authorization["']\s*:\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/giu,
        '$1"[redacted]"',
      )
      .replace(/((?:proxy-)?authorization\s*[:=]\s*)[^\r\n]+/giu, "$1[redacted]")
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/giu, "$1 [redacted]")
      .replace(
        /((?:token|password|passwd|secret|api[_-]?key)["']?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s,;]+)/giu,
        "$1[redacted]",
      )
      // eslint-disable-next-line no-control-regex -- Remove control bytes from displayed diagnostics.
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
  );
}

/** No raw request/cause/stderr is attached to this frontend-visible error. */
export function sourceNetworkError(
  operation: Pick<SourceOperation, "source" | "proxy">,
  phase: string,
  reason: unknown,
  code: SkctlError["code"] = "PROVIDER_UNAVAILABLE",
  secrets: readonly string[] = [],
): SkctlError {
  const credentials = [...secrets];
  if (operation.proxy) {
    try {
      const url = new URL(operation.proxy);
      for (const value of [url.username, url.password]) {
        credentials.push(value);
        try {
          credentials.push(decodeURIComponent(value));
        } catch {
          /* malformed encoding */
        }
      }
    } catch {
      credentials.push(operation.proxy);
    }
  }
  const causes: string[] = [];
  const seen = new Set<unknown>();
  let current = reason;
  for (let depth = 0; depth < 3 && current !== undefined && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error) {
      causes.push(current.message);
      current = current.cause;
    } else if (typeof current === "string" || typeof current === "number") {
      causes.push(String(current));
      break;
    } else break; // Never stringify request objects or environments.
  }
  const network =
    operation.proxy === undefined
      ? "environment/Git configuration"
      : `configured proxy ${operation.proxy}`;
  const label = sanitized(`Source ${operation.source}, ${phase}, ${network}`, credentials).slice(
    0,
    384,
  );
  const detail = sanitized(causes.join("; ") || "Remote acquisition failed", credentials).slice(
    0,
    635,
  );
  return new SkctlError(code, `${label}: ${detail}`);
}
