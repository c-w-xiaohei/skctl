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
import { createReaderOwner } from "../src/reader/state";
import { skillAddressKey, type ReaderState } from "../src/types";
import { readerContent, readerProjection, readerSecondContent } from "./installed-reader.fixture";
import { enterLive, parsedEscape } from "./reader-test-controls";
import { directSourceCore } from "./direct-source.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function mountReader(width = 90, height = 13, maintenance: ActionRecord[] = []) {
  const projection = readerProjection();
  const calls: { id: ActionId | "reload"; address: string }[] = [];
  let api!: {
    reader: () => ReaderState;
    patch: (value: Partial<ReaderState>) => void;
    select: (index: number) => void;
    commands: ReturnType<typeof createCommandRegistry>;
    setWidth: (width: number) => void;
  };
  const setup = await testRender(
    () => {
      const owner = createReaderOwner(directSourceCore(projection));
      for (const content of [readerSecondContent, readerContent]) {
        owner.select(content.address);
        owner.patch({ text: content.markdownText, rawText: content.rawText });
      }
      const [paneWidth, setWidth] = createSignal(width);
      const reader = () => owner.current()!;
      const call = (id: ActionId | "reload") =>
        calls.push({ id, address: skillAddressKey(reader().address!) });
      const actions = (): ActionRecord[] => [
        ...(["skill-check-updates", "skill-add-to-collection"] as const).map((id) => ({
          id,
          verb: id === "skill-check-updates" ? "Check updates" : "Add to Collection…",
          destination: skillAddressKey(reader().address!),
          scope: "page" as const,
          keys: ["enter", "return"],
          enabled: true,
          danger: false,
        })),
        ...maintenance,
      ];
      const commands = createCommandRegistry(() =>
        actions().map((record) => ({ record, execute: () => call(record.id) })),
      );
      api = {
        reader,
        patch: owner.patch,
        commands,
        setWidth,
        select: (index) => owner.select(projection.installedSkills[index]!.address),
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
            focusRegistry={createFocusRegistry()}
            registerCommand={commands.register}
            executeCommand={(id) => {
              commands.execute(id);
            }}
            actions={actions()}
            onPatch={owner.patch}
            onReadResource={() => {}}
            onRetryResource={() => {}}
            onReload={() => call("reload")}
            onResourceBack={() => {}}
            onDetailsAction={call}
            onDetailsRelationship={() => {}}
            onDetailsScroll={(detailsScroll) => owner.patch({ detailsScroll })}
          />
        </box>
      );
    },
    { width: 144, height },
  );
  await setup.flush();
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

test("Reader More scrolls long maintenance commands and disabled reasons within 43x13", async () => {
  const h = await mountReader(43, 13, [
    {
      id: "skill-rebind",
      verb: "Rebind this installed Skill to another registered Source",
      destination: "guide",
      scope: "page",
      keys: ["enter"],
      enabled: false,
      danger: false,
      disabledReason:
        "The owning configuration is read-only. Choose a writable declaration before changing ownership.",
    },
    {
      id: "skill-uninstall",
      verb: "Uninstall this installed Skill from this machine",
      destination: "guide",
      scope: "page",
      keys: ["enter"],
      enabled: true,
      danger: true,
    },
  ]);
  try {
    h.setup.resize(43, 13);
    h.commands.execute("reader.more");
    await h.setup.flush();
    const menu = node(h.setup, "reader-more-dialog");
    expect(menu.height).toBeLessThanOrEqual(11);
    for (let i = 0; i < 4; i++) {
      h.setup.mockInput.pressArrow("down");
      await h.setup.flush();
    }
    const last = node(h.setup, "reader-menu-skill-uninstall");
    expect(h.setup.renderer.currentFocusedRenderable?.id).toBe(last.id);
    expect(
      descendants(menu).some(
        (node) =>
          node instanceof TextRenderable &&
          node.plainText.includes("The owning configuration") &&
          node.height > 1,
      ),
    ).toBe(true);
    const body = node(h.setup, "reader-menu-body") as ScrollBoxRenderable;
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(last.screenY + last.height).toBeLessThanOrEqual(
      body.viewport.screenY + body.viewport.height,
    );
    await enterLive(h.setup, last.id);
    expect(h.calls.map((call) => call.id)).toEqual(["skill-uninstall"]);
  } finally {
    h.setup.renderer.destroy();
  }
});

test.each([100, 80, 43])(
  "Reader keeps identity, object actions and content in bounded rows at %i columns",
  async (width) => {
    const h = await mountReader(width);
    try {
      const identity = node(h.setup, "reader-identity") as TextRenderable;
      const update = h.setup.renderer.root.findDescendantById("reader-action-skill-check-updates");
      const add = node(h.setup, "reader-details-action-skill-add-to-collection");
      const views = node(h.setup, "reader-views");
      const body = node(h.setup, "reader-scrollbox");
      expect(identity.plainText).toBe("guide");
      expect(add.screenY).toBe(identity.screenY + 1);
      expect(!!update).toBe(width >= 46);
      if (update) expect(update.screenY).toBe(add.screenY);
      expect(views.screenY).toBe(add.screenY + 1);
      expect(body.screenY).toBe(views.screenY + 1);
      expect(body.height).toBeGreaterThanOrEqual(8);
      for (const target of [identity, ...(update ? [update] : []), add, views, body])
        expect(target.screenX + target.width).toBeLessThanOrEqual(width);
    } finally {
      h.setup.renderer.destroy();
    }
  },
);

test("More uses the actual pane width; hidden reading commands remain executable after it closes", async () => {
  const h = await mountReader(43);
  try {
    expect(node(h.setup, "reader-pane").width).toBe(43);
    const body = node(h.setup, "reader-scrollbox");
    const markdown = descendants(body).find((child) => child instanceof MarkdownRenderable);
    expect(h.commands.execute("reader.more")).toBe(true);
    await h.setup.waitFor(() => !!h.setup.renderer.root.findDescendantById("reader-more-dialog"));
    expect(node(h.setup, "reader-more-dialog").width).toBeLessThanOrEqual(30);
    await parsedEscape(h.setup);
    expect(node(h.setup, "reader-scrollbox") === body).toBe(true);
    expect(
      descendants(body).find((child) => child instanceof MarkdownRenderable) === markdown,
    ).toBe(true);
    expect(h.commands.execute("reader.raw")).toBe(true);
    await h.setup.flush();
    expect(h.reader().raw).toBe(true);
    expect(h.commands.resolve("reader.raw")?.record.verb).toBe("Show formatted text");
    expect(h.commands.execute("reader.reload")).toBe(true);
    expect(h.commands.execute("skill-add-to-collection")).toBe(true);
    expect(h.calls).toEqual([
      { id: "reload", address: skillAddressKey(readerContent.address) },
      { id: "skill-add-to-collection", address: skillAddressKey(readerContent.address) },
    ]);
    expect(h.commands.execute("reader.installation")).toBe(true);
    await h.setup.waitFor(() => !!h.setup.renderer.root.findDescendantById("reader-details"));
    expect(h.reader().installationOpen).toBe(true);
  } finally {
    h.setup.renderer.destroy();
  }
});

test("Reader keeps Markdown readable and gives More no permanent body row", async () => {
  const h = await mountReader(110, 24);
  try {
    const body = node(h.setup, "reader-scrollbox");
    const y = body.screenY;
    const markdown = descendants(body).find((child) => child instanceof MarkdownRenderable);
    expect(markdown?.width).toBeLessThanOrEqual(88);
    expect(h.commands.execute("reader.more")).toBe(true);
    await h.setup.waitFor(() => !!h.setup.renderer.root.findDescendantById("reader-more-dialog"));
    await parsedEscape(h.setup);
    expect(body.screenY).toBe(y);
    expect(node(h.setup, "reader-scrollbox") === body).toBe(true);
    expect(h.setup.renderer.currentFocusedRenderable?.id).toBe("reader-more");
  } finally {
    h.setup.renderer.destroy();
  }
});

test("Reader switches exact command targets while retaining each Skill's content and reading position", async () => {
  const h = await mountReader(90, 24);
  try {
    h.patch({ raw: true, scroll: 3 });
    await h.setup.flush();
    h.select(1);
    await h.setup.flush();
    expect((node(h.setup, "reader-identity") as TextRenderable).plainText).toBe("reference");
    expect(h.reader().text).toBe(readerSecondContent.markdownText);
    const update = node(h.setup, "reader-action-skill-check-updates");
    await h.setup.mockMouse.click(update.screenX + 1, update.screenY);
    expect(h.commands.execute("reader.reload")).toBe(true);
    expect(h.calls).toEqual([
      { id: "skill-check-updates", address: skillAddressKey(readerSecondContent.address) },
      { id: "reload", address: skillAddressKey(readerSecondContent.address) },
    ]);
    h.select(0);
    await h.setup.flush();
    expect(h.reader()).toMatchObject({ rawText: readerContent.rawText, raw: true, scroll: 3 });
    h.setWidth(43);
    await h.setup.flush();
    expect(h.reader()).toMatchObject({ raw: true, scroll: 3 });
  } finally {
    h.setup.renderer.destroy();
  }
});
