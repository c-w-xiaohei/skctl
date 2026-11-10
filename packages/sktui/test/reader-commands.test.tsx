import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { TextRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { Reader } from "../src/reader";
import { App } from "../src/app";
import { createReaderOwner } from "../src/reader/state";
import { createCommandRegistry } from "../src/commands";
import type { CommandRecord } from "../src/types";
import { directSourceCore } from "./direct-source.fixture";
import { readerAddress, readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterInstalledAddress,
  enterLive,
  live,
  openAllInstalledSkills,
  waitForReaderBody,
} from "./reader-test-controls";
function readerState() {
  const owner = createReaderOwner(directSourceCore(readerProjection()));
  owner.select({ source: "team-main", path: "guide" });
  return owner.current()!;
}
test("Installation command stays available before and after More closes", async () => {
  const commands = createCommandRegistry(() => []);
  const [state, setState] = createSignal(readerState());
  const setup = await testRender(
    () => (
      <Reader
        reader={state}
        projection={() => readerProjection()}
        mode="wide"
        actions={[]}
        registerCommand={commands.register}
        onPatch={(patch) => setState((current) => ({ ...current, ...patch }))}
        onReadResource={() => {}}
        onRetryResource={() => {}}
        onResourceBack={() => {}}
        onDetailsAction={() => {}}
        onDetailsRelationship={() => {}}
        onDetailsScroll={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.flush();
    expect(commands.execute("reader.installation")).toBe(true);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
    expect(state().installationOpen).toBe(true);
    setState((current) => ({ ...current, installationOpen: false }));
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-installation-open");
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("reader-more-dialog"));
    expect(commands.resolve("reader.installation")?.record.enabled).toBe(true);
    expect(state().installationOpen).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Reader registers exact Enter records and describes only mounted resource controls", async () => {
  const [state] = createSignal(readerState());
  const commands = new Map<string, CommandRecord>();
  const setup = await testRender(
    () => (
      <Reader
        reader={state}
        projection={() => undefined}
        mode="wide"
        registerCommand={(record) => {
          commands.set(record.id, record);
          return () => commands.delete(record.id);
        }}
        actions={[]}
        onPatch={() => {}}
        onReadResource={() => {}}
        onRetryResource={() => {}}
        onResourceBack={() => {}}
        onDetailsAction={() => {}}
        onDetailsRelationship={() => {}}
        onDetailsScroll={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await setup.renderOnce();
    expect(commands.get("reader.installation")).toEqual({
      id: "reader.installation",
      keys: ["enter", "return"],
      verb: "Installation details",
      destination: "guide",
      scope: "page",
      enabled: true,
      disabledReason: undefined,
      danger: false,
    });
    expect(commands.get("reader.raw")).toEqual({
      id: "reader.raw",
      keys: ["enter", "return"],
      verb: "Show Markdown source",
      destination: "SKILL.md",
      scope: "page",
      enabled: true,
      disabledReason: undefined,
      danger: false,
    });
    expect([...commands.keys()].some((id) => id.startsWith("reader.resource"))).toBe(false);
    expect(setup.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Reader executes one command once through Enter and pointer without leaving Reader", async () => {
  const reads: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) => {
            reads.push(request);
            return readerContent;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await waitForReaderBody(setup, "needle in prose");
    const views = live(setup, "reader-views");
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-raw");
    await setup.waitForFrame((frame) => frame.includes("title: Guide"));
    expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
    expect(reads).toEqual([{ address: readerAddress }]);
    expect(live(setup, "reader-views") === views).toBe(true);
    await enterLive(setup, "reader-more");
    const prose = live(setup, "reader-menu-raw");
    await setup.flush();
    await setup.mockMouse.click(prose.screenX + 1, prose.screenY);
    await waitForReaderBody(setup, "needle in prose");
    await setup.waitForFrame(
      (frame) => frame.includes("needle in prose") && !frame.includes("title: Guide"),
    );
    expect(live(setup, "reader-views") === views).toBe(true);
    expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
    expect(reads).toEqual([{ address: readerAddress }]);
  } finally {
    setup.renderer.destroy();
  }
});
