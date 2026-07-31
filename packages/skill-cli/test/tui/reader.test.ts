import { expect, test } from "bun:test";
import { SkillCliError } from "../../src/core/api";
import { createTuiEffects as createRealTuiEffects } from "../../src/tui/effects";
import { createOperationState } from "../../src/tui/operation-state";
import { createProjection } from "../../src/tui/projection";
import { findLiteralMatches, rawOffsetForMarkdownMatch } from "../../src/tui/types";
import {
  activeReader,
  beginReaderRequest,
  createReaderState,
  reduceReaderState,
  type ReaderOwnerState,
} from "../../src/tui/reader/state";
import { createWorkspaceState } from "../../src/tui/workspace/state";
import { createCollectionsState } from "../../src/tui/collections/state";
import { createConfigState } from "../../src/tui/config/state";
import {
  directSourceCore,
  testEffects as createTuiEffects,
  workspaceProjection,
} from "./direct-source.fixture";

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
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "content.settle",
      address: { source: "team-main", path: "second" },
      value: expect.objectContaining({ markdownText: "second" }),
    }),
  );
  expect(events).not.toContainEqual(expect.objectContaining({ type: "failure" }));
});

test("STATE-014/015 keeps concurrent SKILL.md content and resource-list transports independent", async () => {
  const address = { source: "team-main", path: "guide" };
  const calls: unknown[] = [];
  let contentSignal: AbortSignal | undefined;
  let resourceSignal: AbortSignal | undefined;
  let resolveContent:
    | ((value: {
        value: {
          address: typeof address;
          name: string;
          description: string;
          rawText: string;
          markdownText: string;
        };
        diagnostics: [];
      }) => void)
    | undefined;
  let resolveResources:
    | ((value: { value: readonly [{ path: "docs"; kind: "directory" }]; diagnostics: [] }) => void)
    | undefined;
  let reader: ReaderOwnerState = reduceReaderState(createReaderState(), {
    type: "select",
    address,
  });
  const operation = createOperationState();
  const projection = createProjection(operation, {
    workspace: createWorkspaceState(),
    collections: createCollectionsState(),
    config: createConfigState(),
  });
  const effects = createRealTuiEffects(
    directSourceCore(workspaceProjection(), {
      loadInstalled: (request, options) => {
        calls.push({ type: "content", request });
        contentSignal = options?.signal;
        return new Promise((resolve) => {
          resolveContent = resolve;
        });
      },
      listInstalledResources: (request, options) => {
        calls.push({ type: "resources", request });
        resourceSignal = options?.signal;
        return new Promise((resolve) => {
          resolveResources = resolve;
        });
      },
    }),
    operation,
    projection.outcomes,
    (event) => {
      reader = reduceReaderState(reader, event);
    },
    (target, request, path) => {
      const begun = beginReaderRequest(reader, target, request, path);
      reader = begun.state;
      return begun.event;
    },
  );

  const content = effects.loadReader(address);
  const resources = effects.listResources(address);

  expect(calls).toEqual([
    { type: "content", request: { address } },
    { type: "resources", request: { address } },
  ]);
  expect(contentSignal?.aborted).toBe(false);
  expect(resourceSignal?.aborted).toBe(false);

  resolveResources!({ value: [{ path: "docs", kind: "directory" }], diagnostics: [] });
  await resources;
  expect(contentSignal?.aborted).toBe(false);
  expect(activeReader(reader)).toMatchObject({
    loading: true,
    resourceLoading: false,
    resources: [{ path: "docs", kind: "directory" }],
  });

  resolveContent!({
    value: {
      address,
      name: "guide",
      description: "Guide",
      rawText: "# Guide",
      markdownText: "# Guide",
    },
    diagnostics: [],
  });
  await content;

  expect(resourceSignal?.aborted).toBe(false);
  expect(activeReader(reader)).toMatchObject({
    loading: false,
    resourceLoading: false,
    text: "# Guide",
    rawText: "# Guide",
    resources: [{ path: "docs", kind: "directory" }],
  });
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
  let reader = createReaderState();
  const address = { source: "team-main", path: "guide" };
  reader = reduceReaderState(reader, { type: "select", address });
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
    (event) => {
      reader = reduceReaderState(reader, event);
      events.push(event);
    },
  );
  const list = effects.listResources(address);
  const read = effects.readResource(address, "guide.md");
  await read;
  rejectList!(new SkillCliError("RESOURCE_NOT_FOUND", "stale list"));
  await list;
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "resource.settle",
      address,
      value: { kind: "text", path: "guide.md", text: "current", format: "text" },
    }),
  );
  expect(activeReader(reader)).toMatchObject({ resource: { path: "guide.md", text: "current" } });
  expect(activeReader(reader)?.error).toBeUndefined();
});
