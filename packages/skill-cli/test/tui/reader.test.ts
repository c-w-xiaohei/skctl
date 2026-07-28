import { expect, test } from "bun:test";
import { SkillCliError } from "../../src/core/api";
import { findLiteralMatches, rawOffsetForMarkdownMatch } from "../../src/tui/model";
import { createTuiEffects } from "../../src/tui/effects";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

test("READ-012 finds literal case-sensitive non-overlapping matches with source positions", () => {
  expect(findLiteralMatches("one one\r\nOne\n😀one", "one")).toEqual([
    { offset: 0, line: 0, column: 0 },
    { offset: 4, line: 0, column: 4 },
    { offset: 15, line: 2, column: 2 },
  ]);
  expect(findLiteralMatches("aaaa", "aa")).toEqual([
    { offset: 0, line: 0, column: 0 },
    { offset: 2, line: 0, column: 2 },
  ]);
  expect(findLiteralMatches("one", "")).toEqual([]);
  expect(rawOffsetForMarkdownMatch("---\ntitle: Demo\n---\n# Demo", "# Demo", 0)).toBe(20);
});

test("STATE-014/015 replaces only the Reader lane and suppresses stale content failures", async () => {
  let firstAbort = 0;
  let resolveSecond:
    | ((value: {
        value: {
          address: { source: string; path: string };
          name: string;
          description: string;
          rawText: string;
          markdownText: string;
        };
        diagnostics: [];
      }) => void)
    | undefined;
  const events: unknown[] = [];
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      loadInstalled: (request, options) =>
        request.address.path === "first"
          ? new Promise((_, reject) =>
              options?.signal?.addEventListener("abort", () => {
                firstAbort++;
                reject(new SkillCliError("CANCELLED", "first cancelled"));
              }),
            )
          : new Promise((resolve) => {
              resolveSecond = resolve;
            }),
    }),
    (event) => events.push(event),
  );
  const first = effects.loadReader({ source: "team-main", path: "first" });
  const second = effects.loadReader({ source: "team-main", path: "second" });
  resolveSecond!({
    value: {
      address: { source: "team-main", path: "second" },
      name: "second",
      description: "Second",
      rawText: "---\n---\nsecond",
      markdownText: "second",
    },
    diagnostics: [],
  });
  await Promise.all([first, second]);
  expect(firstAbort).toBe(1);
  expect(events).toContainEqual({
    type: "reader.loaded",
    address: { source: "team-main", path: "second" },
    value: expect.objectContaining({ markdownText: "second" }),
  });
  expect(events).not.toContainEqual(expect.objectContaining({ type: "reader.failure" }));
});

test("STATE-014 replaces resource list and read requests in the Reader lane without aborting a Source operation", async () => {
  let listAborts = 0;
  let readAborts = 0;
  let discoveryAborts = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      listInstalledResources: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            listAborts++;
            reject(new SkillCliError("CANCELLED", "list cancelled"));
          }),
        ),
      readInstalled: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            readAborts++;
            reject(new SkillCliError("CANCELLED", "read cancelled"));
          }),
        ),
      discover: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            discoveryAborts++;
            reject(new SkillCliError("CANCELLED", "discovery cancelled"));
          }),
        ),
    }),
  );
  const address = { source: "team-main", path: "first" };
  const source = effects.discover({ kind: "source-discovery", source: "team-main" });
  const list = effects.listResources(address);
  const read = effects.readResource(address, "guide.md");
  await Promise.resolve();
  expect(listAborts).toBe(1);
  expect(readAborts).toBe(0);
  expect(discoveryAborts).toBe(0);
  effects.teardown();
  await Promise.all([source, list, read]);
  expect(readAborts).toBe(1);
  expect(discoveryAborts).toBe(1);
});

test("STATE-014 selecting a Reader target aborts only the prior Reader request while Source observation remains pending", async () => {
  let readerAborts = 0;
  let sourceAborts = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      loadInstalled: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            readerAborts++;
            reject(new SkillCliError("CANCELLED", "reader cancelled"));
          }),
        ),
      discover: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            sourceAborts++;
            reject(new SkillCliError("CANCELLED", "source cancelled"));
          }),
        ),
    }),
  );
  const source = effects.discover({ kind: "source-discovery", source: "team-main" });
  const first = effects.loadReader({ source: "team-main", path: "first" });
  const second = effects.loadReader({ source: "team-main", path: "second" });
  await Promise.resolve();
  expect(readerAborts).toBe(1);
  expect(sourceAborts).toBe(0);
  effects.teardown();
  await Promise.all([source, first, second]);
  expect(readerAborts).toBe(2);
  expect(sourceAborts).toBe(1);
});

test("STATE-015 stale resource list failure cannot replace a newer resource read", async () => {
  let rejectList: ((error: SkillCliError) => void) | undefined;
  const events: unknown[] = [];
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      listInstalledResources: (_request, options) =>
        new Promise((_, reject) => {
          rejectList = reject;
          options?.signal?.addEventListener("abort", () => {});
        }),
      readInstalled: async (_request) => ({
        value: { kind: "text", path: "guide.md", text: "current", format: "text" },
        diagnostics: [],
      }),
    }),
    (event) => events.push(event),
  );
  const address = { source: "team-main", path: "guide" };
  const list = effects.listResources(address);
  const read = effects.readResource(address, "guide.md");
  await read;
  rejectList!(new SkillCliError("RESOURCE_NOT_FOUND", "stale list"));
  await list;
  expect(events).toContainEqual({
    type: "reader.resource.loaded",
    address,
    value: { kind: "text", path: "guide.md", text: "current", format: "text" },
  });
  expect(events).not.toContainEqual(
    expect.objectContaining({
      type: "reader.failure",
      diagnostic: expect.objectContaining({ message: "stale list" }),
    }),
  );
});
