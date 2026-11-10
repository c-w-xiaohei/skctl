import { SelectRenderable } from "@opentui/core";
import type { testRender } from "@opentui/solid";
import { enterLive, focusLive, parsedEnter } from "./reader-test-controls";

/** Choose through the current category list; never emulate the removed section tabs. */
export async function openSettingsCategory(
  setup: Awaited<ReturnType<typeof testRender>>,
  category: "sources" | "config-sources" | "collections" | "interface",
) {
  if (!setup.renderer.root.findDescendantById("settings-categories"))
    await enterLive(setup, "config-command-config.categories");
  const target = await focusLive(setup, "settings-categories");
  if (!(target instanceof SelectRenderable)) throw new Error("Expected Settings category list");
  const index = target.options.findIndex((item) => item.value === category);
  if (index < 0) throw new Error(`Missing Settings category ${category}`);
  while (target.getSelectedIndex() !== index) {
    setup.mockInput.pressArrow(target.getSelectedIndex() < index ? "down" : "up");
    await setup.flush();
  }
  await parsedEnter(setup);
}
