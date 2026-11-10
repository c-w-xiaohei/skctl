import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import { Pane } from "../src/ui/pane";

test("Many panes share one size subscription and release it when their owner leaves", async () => {
  const [visible, setVisible] = createSignal(false);
  const setup = await testRender(
    () => (
      <box>
        <Show when={visible()}>
          <For each={Array.from({ length: 8 }, (_, id) => id)}>
            {(id) => (
              <Pane id={`pane-${id}`} title={`Pane ${id}`}>
                <text>Body</text>
              </Pane>
            )}
          </For>
        </Show>
      </box>
    ),
    { width: 120, height: 40 },
  );
  try {
    const baseline = setup.renderer.listenerCount("resize");
    setVisible(true);
    await setup.flush();
    expect(setup.renderer.listenerCount("resize") - baseline).toBe(1);
    const pane = setup.renderer.root.findDescendantById("pane-0")!;
    expect(pane.getChildren()[0]!.height).toBe(1);
    setup.resize(80, 20);
    await setup.flush();
    expect(pane.getChildren()[0]!.height).toBe(1);
    setVisible(false);
    await setup.flush();
    expect(setup.renderer.listenerCount("resize")).toBe(baseline);
  } finally {
    setup.renderer.destroy();
  }
});
