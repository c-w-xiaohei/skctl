import { SkctlError } from "../../../shared";
import type { SourceNetwork } from "../../types";
export const sourceCheckBudgetMs = 30_000;
export const sourceContentBudgetMs = 120_000;

/** One frozen remote-preparation lifetime; providers/fallbacks reuse, never renew it. */
export interface SourceOperation extends SourceNetwork {
  readonly source: string;
  readonly signal: AbortSignal;
  readonly throwIfAborted: (phase: string) => void;
  readonly [Symbol.dispose]: () => void;
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
  const callerSignal = input.signal;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), budgetMs);
  timer.unref();
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal;
  const operation: SourceOperation = Object.freeze({
    source: input.source,
    ...(input.proxy === undefined ? {} : { proxy: input.proxy }),
    signal,
    throwIfAborted(phase: string) {
      if (signal.aborted)
        throw sourceNetworkError(
          operation,
          phase,
          deadline.signal.aborted && signal.reason === deadline.signal.reason
            ? "PROVIDER_TIMEOUT"
            : "CANCELLED",
        );
    },
    [Symbol.dispose]: () => clearTimeout(timer),
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
      throw new SkctlError(
        "PROVIDER_UNAVAILABLE",
        "Explicit source proxy requires Bun 1.4.3 or newer",
      );
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return fetch(input, {
      ...init,
      signal:
        requestSignal && requestSignal !== operation.signal
          ? AbortSignal.any([operation.signal, requestSignal])
          : operation.signal,
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

/** Raw provider messages, response bodies and stderr never cross this boundary. */
export function sourceNetworkError(
  operation: Pick<SourceOperation, "source" | "proxy">,
  phase: string,
  code: SkctlError["code"] = "PROVIDER_UNAVAILABLE",
): SkctlError {
  const network =
    operation.proxy === undefined
      ? "environment/Git configuration"
      : `configured proxy ${new URL(operation.proxy).origin}`;
  return new SkctlError(code, `Source ${operation.source}, ${phase}, ${network}: ${code}`);
}
