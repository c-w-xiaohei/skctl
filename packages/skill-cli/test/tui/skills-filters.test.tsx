import { expect, test } from "bun:test";
import { InputRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";

test("RENDER Skills browser owns slash query and updates its local result count", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Installed Skills"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    setup.mockInput.pressKey("/");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
    await setup.mockInput.pressKey("f");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 1/2"));
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "f",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER filtering selected A reconciles Reader and Actions to visible B", async () => {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async ({ address }) => {
            loads.push(address.path);
            return { value: readerContent, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("guide") && frame.includes("reference"));
    setup.mockInput.pressKey("/");
    await setup.renderOnce();
    for (const key of ["r", "e", "f"]) {
      await setup.mockInput.pressKey(key);
      await setup.renderOnce();
    }
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 1/2"));
    expect(loads.at(-1)).toBe("reference");
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    browser?.focus();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    setup.mockInput.pressKey("ARROW_RIGHT");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    setup.mockInput.pressKey("ARROW_RIGHT");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Address  team-main/reference"));
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
    );
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Actions"));
  } finally {
    setup.renderer.destroy();
  }
});
