/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { SectionTabs } from "../src/components/section-tabs";
import { createFocusRegistry } from "../src/focus";
import { parseNavKey } from "../src/navigation";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

test("parseNavKey preserves every OpenTUI modifier", () => {
  expect(
    parseNavKey({
      name: "ArrowLeft",
      ctrl: true,
      shift: true,
      alt: true,
      meta: true,
      option: true,
      super: true,
      hyper: true,
    }),
  ).toMatchObject({
    name: "left",
    ctrl: true,
    shift: true,
    alt: true,
    meta: true,
    option: true,
    super: true,
    hyper: true,
  });
});

test.each([
  ["meta", { meta: true }],
  ["option", { option: true }],
  ["super", { super: true }],
  ["hyper", { hyper: true }],
] as const)("modified %s navigation keys do not move native tabs", async (_modifier, modifier) => {
  const registry = createFocusRegistry();
  const navigations: string[] = [];
  const [value, setValue] = createSignal("skills");
  setup = await testRender(
    () => (
      <SectionTabs
        id="modifier-tabs"
        options={[
          { label: "Skills", value: "skills" },
          { label: "Collections", value: "collections" },
          { label: "Sources", value: "sources" },
        ]}
        value={value()}
        owner="local-nav"
        focusRegistry={registry}
        onNavigate={(next) => {
          navigations.push(next);
          setValue(next);
        }}
      />
    ),
    { width: 60, height: 3 },
  );
  await setup.renderOnce();
  expect(registry.applyFocus("local-nav")).toBe(true);
  const focused = setup.renderer.currentFocusedRenderable;

  for (const name of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
    const result = registry.dispatchMode(
      registry.target("local-nav"),
      parseNavKey({ name, ...modifier }),
    );
    expect(result).toBe("declined");
    expect(value()).toBe("skills");
    expect(navigations).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable === focused).toBe(true);
  }
});

test("unmodified native tab arrows still navigate", async () => {
  const registry = createFocusRegistry();
  const [value, setValue] = createSignal("skills");
  setup = await testRender(
    () => (
      <SectionTabs
        id="plain-tabs"
        options={[
          { label: "Skills", value: "skills" },
          { label: "Collections", value: "collections" },
        ]}
        value={value()}
        owner="local-nav"
        focusRegistry={registry}
        onNavigate={setValue}
      />
    ),
    { width: 50, height: 3 },
  );
  await setup.renderOnce();
  expect(registry.applyFocus("local-nav")).toBe(true);

  expect(
    registry.dispatchMode(registry.target("local-nav"), parseNavKey({ name: "ArrowRight" })),
  ).toBe("consumed");
  expect(value()).toBe("collections");
});
