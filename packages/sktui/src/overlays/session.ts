import type { FocusOwner, Overlay } from "../types";

export type OverlayPhase = "review" | "preview" | "observing" | "executing" | "cancelling";

export interface OverlaySession {
  readonly revision: number;
  readonly kind?: Overlay;
  readonly payload?: unknown;
  readonly phase?: OverlayPhase;
  readonly restoreFocus?: FocusOwner;
  /** Identifies one preview/observe/execute attempt within a visible session. */
  readonly requestEpoch: number;
  readonly dismissed?: boolean;
  readonly cancelRequested?: boolean;
}

export type OverlaySessionEvent =
  | {
      readonly type: "open";
      readonly kind: Overlay;
      readonly payload?: unknown;
      readonly phase?: OverlayPhase;
      readonly restoreFocus?: FocusOwner;
    }
  | { readonly type: "begin"; readonly revision: number; readonly phase: OverlayPhase }
  | { readonly type: "retry"; readonly revision: number; readonly phase?: OverlayPhase }
  | {
      readonly type: "replace";
      readonly revision: number;
      readonly requestEpoch?: number;
      readonly payload: unknown;
      readonly phase?: OverlayPhase;
    }
  | {
      readonly type: "settle";
      readonly revision: number;
      readonly requestEpoch?: number;
      readonly phase: OverlayPhase;
      readonly payload?: unknown;
    }
  | { readonly type: "requestDismiss"; readonly revision?: number }
  | { readonly type: "close"; readonly revision?: number };

export const createOverlaySession = (): OverlaySession => ({ revision: 0, requestEpoch: 0 });

/** A completion may affect only the exact visible session and payload family that began it. */
export const sessionMatches = (
  session: OverlaySession,
  begun: Pick<OverlaySession, "revision" | "requestEpoch">,
  kind: NonNullable<OverlaySession["kind"]>,
  family: string,
) =>
  session.revision === begun.revision &&
  session.requestEpoch === begun.requestEpoch &&
  session.kind === kind &&
  (session.payload as { readonly family?: unknown } | undefined)?.family === family;

export function reduceOverlaySession(
  session: OverlaySession,
  event: OverlaySessionEvent,
): OverlaySession {
  if (event.type === "open")
    return {
      revision: session.revision + 1,
      requestEpoch: 0,
      kind: event.kind,
      payload: event.payload,
      phase: event.phase ?? "review",
      restoreFocus: session.kind ? session.restoreFocus : event.restoreFocus,
    };
  if (event.type === "close") {
    if (!session.kind || (event.revision !== undefined && event.revision !== session.revision))
      return session;
    return { revision: session.revision + 1, requestEpoch: 0 };
  }
  if (event.type === "requestDismiss") {
    if (
      !session.kind ||
      session.dismissed ||
      (event.revision !== undefined && event.revision !== session.revision)
    )
      return session;
    const pending =
      session.phase === "preview" || session.phase === "observing" || session.phase === "executing";
    return {
      ...session,
      dismissed: true,
      cancelRequested: pending || session.cancelRequested,
      phase: pending ? "cancelling" : session.phase,
    };
  }
  if (event.revision !== session.revision || session.dismissed) return session;
  if (event.type === "begin")
    return {
      ...session,
      requestEpoch: session.requestEpoch + 1,
      phase: event.phase,
      cancelRequested: undefined,
    };
  if (event.type === "retry")
    return {
      ...session,
      requestEpoch: session.requestEpoch + 1,
      phase: event.phase ?? session.phase,
      dismissed: undefined,
      cancelRequested: undefined,
    };
  if (event.requestEpoch !== undefined && event.requestEpoch !== session.requestEpoch)
    return session;
  if (event.type === "replace")
    return { ...session, payload: event.payload, phase: event.phase ?? session.phase };
  return { ...session, payload: event.payload ?? session.payload, phase: event.phase };
}
