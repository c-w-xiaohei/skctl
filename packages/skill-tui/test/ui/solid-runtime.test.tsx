/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createContext, createSignal, useContext } from "solid-js";
import { SectionTabs } from "../../src/components/section-tabs";
import { createFocusRegistry } from "../../src/focus";

test("W1 runtime uses one Solid context for OpenTUI and production SectionTabs", async () => {
  const Context = createContext<string>();
  const registry = createFocusRegistry();
  const [value, setValue] = createSignal<"one" | "two">("one");
  const commands: string[] = [];
  let observed: string | undefined;
  const setup = await testRender(
    () => (
      <Context.Provider value="shared">
        <SectionTabs
          id="runtime-tabs"
          owner="local-nav"
          focusRegistry={registry}
          value={value()}
          options={[
            { label: "One", value: "one" },
            { label: "Two", value: "two" },
          ]}
          commandForDirection={(direction) => ({
            id: `tab-${direction}`,
            keys: [],
            verb: "navigate",
            destination: direction,
            scope: "page",
            enabled: true,
            danger: false,
          })}
          onNavigate={(next, command) => {
            commands.push(command?.destination ?? "");
            setValue(next);
          }}
        />
        {(() => {
          observed = useContext(Context);
          return null;
        })()}
      </Context.Provider>
    ),
    { width: 30, height: 2 },
  );
  try {
    expect(observed).toBe("shared");
    expect(registry.applyFocus("local-nav")).toBe(true);
    const first = setup.renderer.root.findDescendantById("runtime-tabs-tab-one")!;
    const second = setup.renderer.root.findDescendantById("runtime-tabs-tab-two")!;
    expect(first.screenY).toBe(second.screenY);
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(value()).toBe("two");
    expect(commands).toEqual(["next"]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("runtime-tabs-tab-two");
    expect(second.screenX).toBeGreaterThan(first.screenX);
  } finally {
    setup.renderer.destroy();
  }
});
