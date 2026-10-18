import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { TextRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { Reader } from "../src/reader";
import { App } from "../src/app";
import { createReaderOwner } from "../src/reader/state";
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
        onCommitFind={() => {}}
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
    expect([...commands.values()]).toEqual([
      {
        id: "reader.find",
        keys: ["enter", "return"],
        verb: "Find",
        destination: "Search this Skill",
        scope: "page",
        enabled: true,
        disabledReason: undefined,
        danger: false,
      },
      {
        id: "reader.raw",
        keys: ["enter", "return"],
        verb: "Raw",
        destination: "SKILL.md",
        scope: "page",
        enabled: true,
        disabledReason: undefined,
        danger: false,
      },
    ]);
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
          loadInstalledSkill: async (
            _environment: import("@skill-cli/core").CoreOptions,
            request,
          ) => {
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
    await enterLive(setup, "reader-raw");
    await setup.waitForFrame((frame) => frame.includes("title: Guide"));
    expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
    expect(reads).toEqual([{ address: readerAddress }]);
    expect(live(setup, "reader-views") === views).toBe(true);
    const prose = live(setup, "reader-raw");
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
