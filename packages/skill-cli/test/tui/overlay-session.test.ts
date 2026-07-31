import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  createOverlaySession,
  reduceOverlaySession,
  sessionMatches,
  type OverlaySession,
} from "../../src/tui/overlays/session";

const opened = (kind: OverlaySession["kind"], phase: NonNullable<OverlaySession["phase"]>) =>
  reduceOverlaySession(createOverlaySession(), {
    type: "open",
    kind: kind!,
    payload: { family: kind },
    phase,
    restoreFocus: "inspector",
  });

test("OverlaySession dismisses a preview once and ignores its late settlement", () => {
  let session = createOverlaySession();
  session = reduceOverlaySession(session, {
    type: "open",
    kind: "confirm",
    payload: { request: "first" },
    phase: "preview",
    restoreFocus: "inspector",
  });
  const revision = session.revision;
  session = reduceOverlaySession(session, { type: "requestDismiss" });
  session = reduceOverlaySession(session, { type: "requestDismiss" });
  session = reduceOverlaySession(session, { type: "settle", revision, phase: "review" });

  expect(session.cancelRequested).toBe(true);
  expect(session.dismissed).toBe(true);
  expect(session.phase).toBe("cancelling");
  expect(session.payload).toEqual({ request: "first" });
});

test("OverlaySession isolates an old completion after close and reopen ABA", () => {
  let session = createOverlaySession();
  session = reduceOverlaySession(session, {
    type: "open",
    kind: "selection",
    payload: { source: "A" },
    phase: "observing",
  });
  const oldRevision = session.revision;
  session = reduceOverlaySession(session, { type: "close" });
  session = reduceOverlaySession(session, {
    type: "open",
    kind: "selection",
    payload: { source: "A" },
    phase: "observing",
  });
  session = reduceOverlaySession(session, {
    type: "replace",
    revision: oldRevision,
    payload: { source: "late" },
  });

  expect(session.revision).not.toBe(oldRevision);
  expect(session.payload).toEqual({ source: "A" });
});

test("OverlaySession accepts a result only from its active revision and request epoch", () => {
  let session = opened("source-observation", "observing");
  const revision = session.revision;
  const requestEpoch = session.requestEpoch;
  session = reduceOverlaySession(session, {
    type: "settle",
    revision,
    requestEpoch: requestEpoch + 1,
    phase: "review",
    payload: { family: "late" },
  });
  expect(session.phase).toBe("observing");

  session = reduceOverlaySession(session, {
    type: "settle",
    revision,
    requestEpoch,
    phase: "review",
    payload: { family: "review" },
  });
  expect(session.phase).toBe("review");
  expect(session.payload).toEqual({ family: "review" });
});

test("OverlaySession completion matching requires the expected payload family for same-kind forms", () => {
  const session = reduceOverlaySession(createOverlaySession(), {
    type: "open",
    kind: "form",
    payload: { family: "collection-draft" },
    phase: "preview",
  });

  expect(sessionMatches(session, session, "form", "collection-draft")).toBe(true);
  expect(sessionMatches(session, session, "form", "membership-draft")).toBe(false);
});

test("OverlaySession phase matrix makes dismissal authority explicit", () => {
  for (const phase of ["review", "preview", "observing", "executing", "cancelling"] as const) {
    let session = opened("confirm", phase);
    session = reduceOverlaySession(session, { type: "requestDismiss", revision: session.revision });
    expect(session.dismissed).toBe(true);
    expect(session.phase).toBe(
      phase === "preview" || phase === "observing" || phase === "executing" ? "cancelling" : phase,
    );
    expect(session.cancelRequested).toBe(
      phase === "preview" || phase === "observing" || phase === "executing" ? true : undefined,
    );
  }
});

test("OverlaySession changes request epochs on retry and never restores a closed session", () => {
  let session = opened("installed-preview", "preview");
  const revision = session.revision;
  const firstEpoch = session.requestEpoch;
  session = reduceOverlaySession(session, { type: "retry", revision });
  expect(session.requestEpoch).toBe(firstEpoch + 1);
  session = reduceOverlaySession(session, { type: "requestDismiss" });
  expect(session.phase).toBe("cancelling");
  session = reduceOverlaySession(session, { type: "close", revision });
  expect(session.kind).toBeUndefined();
  session = reduceOverlaySession(session, {
    type: "settle",
    revision,
    requestEpoch: firstEpoch + 1,
    phase: "review",
  });
  expect(session.kind).toBeUndefined();
  expect(session.restoreFocus).toBeUndefined();
});

test("OverlaySession closes only the exact live revision once", () => {
  let session = opened("confirm", "review");
  const revision = session.revision;
  session = reduceOverlaySession(session, { type: "close", revision });
  const closedRevision = session.revision;
  session = reduceOverlaySession(session, { type: "close", revision });

  expect(session.revision).toBe(closedRevision);
  expect(session.kind).toBeUndefined();
});

test("OverlaySession turns a confirm execution into cancellable work", () => {
  let session = opened("confirm", "review");
  const revision = session.revision;
  session = reduceOverlaySession(session, { type: "begin", revision, phase: "executing" });
  session = reduceOverlaySession(session, { type: "requestDismiss", revision });

  expect(session.phase).toBe("cancelling");
  expect(session.cancelRequested).toBe(true);
});

test("OverlaySession keeps the original restore owner across nested replacement", () => {
  let session = opened("form", "review");
  const revision = session.revision;
  session = reduceOverlaySession(session, {
    type: "replace",
    revision,
    payload: { family: "nested-review" },
    phase: "review",
  });

  expect(session.restoreFocus).toBe("inspector");
  expect(session.payload).toEqual({ family: "nested-review" });
});

test("OverlaySession keeps the original restore owner across nested open", () => {
  let session = opened("form", "review");
  session = reduceOverlaySession(session, {
    type: "open",
    kind: "confirm",
    payload: { family: "nested-confirm" },
    phase: "review",
    restoreFocus: "dialog",
  });

  expect(session.restoreFocus).toBe("inspector");
});

test("App keeps remaining overlay payload metadata in OverlaySession", async () => {
  const app = await readFile(new URL("../../src/tui/app.tsx", import.meta.url), "utf8");
  for (const legacySignal of [
    "collectionChoices",
    "collectionCreate",
    "membershipDraft",
    "membershipChooser",
    "collectionReview",
    "collectionDraft",
    "configOperation",
    "sourceRegistration",
    "filterDimension",
    "filterSearch",
  ])
    expect(app).not.toContain(`const [${legacySignal}, set`);
});
