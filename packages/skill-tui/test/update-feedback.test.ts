import { expect, test } from "bun:test";
import { updateFeedback } from "../src/updates/feedback";
import type { UpdateRun } from "../src/updates/state";

const first = { source: "fixture-source", path: "fixture" };
const second = { source: "other-source", path: "other" };
const run = (results: UpdateRun["results"]): UpdateRun => ({
  phase: "settled",
  addresses: results.map((result) => result.address),
  results,
});

test("ownership feedback comes from the guard cause, deduplicates the atomic batch, and offers inspection not a retry", () => {
  const third = { ...first, path: "second" };
  const issue = { kind: "ownership" as const, address: first };
  const detail = "opaque diagnostic, not a presentation parser input";
  const notices = updateFeedback(
    [first, third],
    [{ source: first.source, expanded: false, status: "failed", error: detail }],
    run([first, third].map((address) => ({ address, status: "failed", issue, message: detail }))),
  );
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    source: first.source,
    address: first,
    title: "Update blocked",
    recovery: "inspect-skill",
    detail,
  });
});

test("Source drill-down cannot show another Source's diagnostic or recovery target", () => {
  const notices = updateFeedback(
    [second],
    [{ source: first.source, expanded: false, status: "failed", error: "first failure" }],
    run([
      {
        address: first,
        status: "failed",
        message: "first failure",
        issue: { kind: "ownership", address: first },
      },
      { address: second, status: "unknown", message: "second failure" },
    ]),
  );
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    source: second.source,
    title: "Result not confirmed",
    recovery: "inspect-source",
    detail: "second failure",
  });
  expect(notices[0]!.body).not.toContain("kept");
});

test("check failure has a bounded recheck while validated metadata rejection directs the user to its Source", () => {
  expect(
    updateFeedback(
      [first],
      [
        {
          source: first.source,
          expanded: false,
          status: "failed",
          error: "private transport diagnostic",
        },
      ],
    )[0],
  ).toMatchObject({ title: "Check failed", recovery: "recheck" });
  expect(
    updateFeedback(
      [first],
      [],
      run([
        {
          address: first,
          status: "failed",
          message: "invalid file",
          issue: { kind: "metadata", address: first },
        },
      ]),
    )[0],
  ).toMatchObject({ title: "Update blocked", address: first, recovery: "inspect-source" });
});
