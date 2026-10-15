import { expect, test } from "bun:test";
import {
  CodeRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { ActionId, ActionRecord } from "../src/actions";
import { createCommandRegistry } from "../src/commands";
import { createFocusRegistry } from "../src/focus";
import { Reader } from "../src/reader";
import { activeReader, createReaderState, reduceReaderState } from "../src/reader/state";
import { skillAddressKey, type ReaderState } from "../src/types";
import { readerContent, readerProjection, readerSecondContent } from "./installed-reader.fixture";
import { parsedEnter } from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function mountReader(width = 90, height = 13) {
  const projection = readerProjection();
  let initial = createReaderState();
  for (const content of [readerSecondContent, readerContent]) {
    initial = reduceReaderState(initial, { type: "select", address: content.address });
    initial = reduceReaderState(initial, {
      type: "patch",
      value: { text: content.markdownText, rawText: content.rawText },
    });
  }
  const calls: { id: ActionId | "reload"; address: string }[] = [];
  let api!: {
    reader: () => ReaderState;
    patch: (value: Partial<ReaderState>) => void;
    select: (index: number) => void;
    commands: ReturnType<typeof createCommandRegistry>;
    focus: ReturnType<typeof createFocusRegistry>;
    setWidth: (width: number) => void;
  };
  const setup = await testRender(
    () => {
      const [owner, setOwner] = createSignal(initial);
      const [paneWidth, setWidth] = createSignal(width);
      const reader = () => activeReader(owner())!;
      const patch = (value: Partial<ReaderState>) =>
        setOwner((current) => reduceReaderState(current, { type: "patch", value }));
      const call = (id: ActionId | "reload") =>
        calls.push({ id, address: skillAddressKey(reader().address!) });
      const actions = (): ActionRecord[] =>
        (["skill-check-updates", "skill-add-to-collection"] as const).map((id) => ({
          id,
          verb: id === "skill-check-updates" ? "Update Skill" : "Add Skill to Collection…",
          destination: skillAddressKey(reader().address!),
          scope: "page",
          keys: ["enter", "return"],
          enabled: true,
          danger: false,
        }));
      const commands = createCommandRegistry(() =>
        actions().map((record) => ({ record, execute: () => call(record.id) })),
      );
      const focus = createFocusRegistry();
      api = {
        reader,
        patch,
        commands,
        focus,
        setWidth,
        select: (index) =>
          setOwner((current) =>
            reduceReaderState(current, {
              type: "select",
              address: projection.installedSkills[index]!.address,
            }),
          ),
      };
      return (
        <box width={paneWidth()} height="100%" flexDirection="column">
          <Reader
            reader={reader}
            projection={() => projection}
            skill={projection.installedSkills.find(
              (skill) => skillAddressKey(skill.address) === skillAddressKey(reader().address!),
            )}
            mode="wide"
            focusRegistry={focus}
            registerCommand={commands.register}
            executeCommand={(id) => {
              commands.execute(id);
            }}
            actions={actions()}
            onPatch={patch}
            onCommitFind={(find) => patch({ find })}
            onResources={() => {}}
            onReadResource={() => {}}
            onRetryResource={() => {}}
            onReload={() => call("reload")}
            onResourceBack={() => {}}
            onDetailsAction={call}
            onDetailsRelationship={() => {}}
            onDetailsScroll={(detailsScroll) => patch({ detailsScroll })}
          />
        </box>
      );
    },
    { width: 144, height },
  );
  await setup.renderOnce();
  await setup.renderOnce();
  // The initial prose contains a fenced code block. Let its actual highlighting
  // finish before a test replaces that prose or destroys the renderer/client.
  await Promise.all(
    descendants(setup.renderer.root)
      .filter((child): child is CodeRenderable => child instanceof CodeRenderable)
      .map((code) => code.highlightingDone),
  );
  return { setup, calls, ...api };
}

function node(setup: Setup, id: string) {
  const target = setup.renderer.root.findDescendantById(id);
  if (!target) throw new Error(`Missing production Reader control ${id}`);
  return target;
}

function descendants(target: ReturnType<typeof node>): ReturnType<typeof node>[] {
  return target.getChildren().flatMap((child) => [child, ...descendants(child)]);
}

test("RENDER Reader gives identity and views two rows and retains compact body height", async () => {
  for (const width of [100, 80, 43]) {
    const h = await mountReader(width);
    try {
      const identity = node(h.setup, "reader-identity") as TextRenderable;
      const update = node(h.setup, "reader-action-skill-check-updates");
      const views = node(h.setup, "reader-views");
      const body = node(h.setup, "reader-scrollbox");
      expect(identity.plainText).toBe("guide");
      expect(update.screenY).toBe(identity.screenY);
      expect(views.screenY).toBe(identity.screenY + 1);
      expect(body.screenY).toBe(identity.screenY + 2);
      expect(body.height).toBe(11);
      expect(update.screenX + update.width).toBeLessThanOrEqual(width);
      expect(views.width).toBeLessThanOrEqual(width);
      expect(
        h.setup.renderer.root.findDescendantById("reader-action-skill-add-to-collection"),
      ).toBeUndefined();
      expect(h.setup.renderer.root.findDescendantById("reader-reload")).toBeUndefined();
    } finally {
      h.setup.renderer.destroy();
    }
  }
});

test("RENDER Reader uses actual pane width and keeps hidden controls executable in Actions", async () => {
  const h = await mountReader(43);
  try {
    expect(h.setup.renderer.width).toBe(144);
    expect(node(h.setup, "reader-pane").width).toBe(43);
    expect(h.setup.renderer.root.findDescendantById("reader-raw")).toBeUndefined();
    expect(h.setup.renderer.root.findDescendantById("reader-find-open")).toBeUndefined();
    expect(h.commands.execute("reader.raw")).toBe(true);
    await h.setup.renderOnce();
    expect(h.reader().raw).toBe(true);
    expect(h.commands.resolve("reader.raw")?.record.verb).toBe("Prose");
    expect(h.commands.execute("reader.reload")).toBe(true);
    expect(h.commands.execute("skill-add-to-collection")).toBe(true);
    expect(h.calls).toEqual([
      { id: "reload", address: skillAddressKey(readerContent.address) },
      { id: "skill-add-to-collection", address: skillAddressKey(readerContent.address) },
    ]);
    h.setWidth(20);
    await h.setup.renderOnce();
    await h.setup.renderOnce();
    expect(
      h.setup.renderer.root.findDescendantById("reader-action-skill-check-updates"),
    ).toBeUndefined();
    expect(h.commands.execute("skill-check-updates")).toBe(true);
    expect(h.calls.at(-1)).toEqual({
      id: "skill-check-updates",
      address: skillAddressKey(readerContent.address),
    });
    h.setWidth(43);
    h.patch({ tab: "details", detailsManagementOpen: true });
    await h.setup.renderOnce();
    expect(node(h.setup, "reader-reload")).toBeDefined();
    expect(node(h.setup, "reader-details-action-skill-add-to-collection")).toBeDefined();
    expect(h.commands.resolve("reader.raw")).toBeUndefined();
    expect(h.setup.captureCharFrame()).toContain("team-main/guide");
  } finally {
    h.setup.renderer.destroy();
  }
});

test("RENDER reading tools stay beside views, with a separate body rhythm only when height allows", async () => {
  const h = await mountReader(110, 24);
  try {
    const views = node(h.setup, "reader-views");
    const find = node(h.setup, "reader-find-open");
    const body = node(h.setup, "reader-scrollbox");
    expect(find.screenX - (views.screenX + views.width)).toBeLessThanOrEqual(3);
    expect(find.screenY).toBe(views.screenY);
    expect(body.screenY).toBe(views.screenY + 2);
    const markdown = descendants(body).find((child) => child instanceof MarkdownRenderable);
    expect(markdown?.width).toBeLessThanOrEqual(88);
    expect(h.commands.execute("reader.find")).toBe(true);
    await h.setup.flush();
    expect(node(h.setup, "reader-scrollbox")).toBe(body);
    expect(body.screenY).toBe(views.screenY + 3);
  } finally {
    h.setup.renderer.destroy();
  }
});

test("RENDER Find keeps the tabs and cached prose stable while temporarily using one body row", async () => {
  const h = await mountReader(100);
  try {
    const body = node(h.setup, "reader-scrollbox");
    const markdown = descendants(body).find((child) => child instanceof MarkdownRenderable);
    expect(markdown).toBeDefined();
    const y = body.screenY;
    expect(h.commands.execute("reader.find")).toBe(true);
    await h.setup.renderOnce();
    expect(h.setup.renderer.currentFocusedRenderable?.id).toBe("reader-find");
    h.setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
    await h.setup.waitFor(() => h.commands.resolve("reader.find.next") !== undefined);
    await parsedEnter(h.setup);
    expect(h.reader().find).toBe("needle");
    expect(h.commands.execute("reader.find.next")).toBe(true);
    await h.setup.renderOnce();
    expect(h.reader().match).toBe(1);
    expect(node(h.setup, "reader-find").screenY).toBe(y);
    expect(node(h.setup, "reader-find-next").screenY).toBe(y);
    expect(node(h.setup, "reader-scrollbox")).toBe(body);
    expect(body.screenY).toBe(y + 1);
    expect(descendants(body).find((child) => child instanceof MarkdownRenderable)).toBe(markdown);
    h.setWidth(43);
    await h.setup.renderOnce();
    await h.setup.renderOnce();
    expect(h.setup.renderer.root.findDescendantById("reader-find-next")).toBeUndefined();
    expect(h.commands.execute("reader.find.next")).toBe(true);
    expect(h.reader().match).toBe(2);
    expect(node(h.setup, "reader-find").screenY).toBe(y);
    expect(body.screenY).toBe(y + 1);
    const input = node(h.setup, "reader-find");
    input.focus();
    expect(
      h.focus.dispatchMode(input, { name: "escape", ctrl: false, alt: false, shift: false }),
    ).toBe("consumed");
    await h.setup.renderOnce();
    expect(h.setup.renderer.currentFocusedRenderable).toBe(body);
    expect(h.commands.resolve("reader.find.next")).toBeUndefined();
  } finally {
    h.setup.renderer.destroy();
  }
});

test("RENDER Reader switches current identity and command target without replacing cached payloads", async () => {
  const h = await mountReader(90, 24);
  try {
    h.patch({ raw: true, find: "needle", scroll: 3 });
    await h.setup.renderOnce();
    const body = node(h.setup, "reader-scrollbox") as ScrollBoxRenderable;
    h.select(1);
    await h.setup.renderOnce();
    expect((node(h.setup, "reader-identity") as TextRenderable).plainText).toBe("reference");
    expect(h.reader().text).toBe(readerSecondContent.markdownText);
    const update = node(h.setup, "reader-action-skill-check-updates");
    await h.setup.mockMouse.click(update.screenX + 1, update.screenY);
    expect(h.calls).toEqual([
      { id: "skill-check-updates", address: skillAddressKey(readerSecondContent.address) },
    ]);
    expect(h.commands.execute("reader.reload")).toBe(true);
    expect(
      h.calls.every((call) => call.address === skillAddressKey(readerSecondContent.address)),
    ).toBe(true);
    h.select(0);
    await h.setup.renderOnce();
    expect((node(h.setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
    expect(h.reader().rawText).toBe(readerContent.rawText);
    expect(h.reader().raw).toBe(true);
    expect(h.reader().find).toBe("needle");
    expect(h.reader().scroll).toBe(3);
    expect(node(h.setup, "reader-scrollbox")).toBe(body);
    h.setWidth(43);
    await h.setup.renderOnce();
    await h.setup.renderOnce();
    expect(h.reader().scroll).toBe(3);
    expect(h.reader().raw).toBe(true);
  } finally {
    h.setup.renderer.destroy();
  }
});

test("RENDER resizing a focused reading tool returns focus to the body, not a hidden control", async () => {
  const h = await mountReader(80);
  try {
    const raw = node(h.setup, "reader-raw");
    const body = node(h.setup, "reader-scrollbox");
    raw.focus();
    expect(h.setup.renderer.currentFocusedRenderable).toBe(raw);
    h.setWidth(43);
    await h.setup.renderOnce();
    await h.setup.renderOnce();
    await h.setup.waitFor(
      () => h.setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox",
    );
    expect(h.setup.renderer.currentFocusedRenderable).toBe(body);
    expect(body.visible).toBe(true);
    expect(body.parent).toBeDefined();
    expect(h.setup.renderer.root.findDescendantById("reader-raw")).toBeUndefined();
    expect(h.reader().raw).toBe(false);
    expect(h.commands.execute("reader.raw")).toBe(true);
    expect(h.reader().raw).toBe(true);
  } finally {
    h.setup.renderer.destroy();
  }
});
