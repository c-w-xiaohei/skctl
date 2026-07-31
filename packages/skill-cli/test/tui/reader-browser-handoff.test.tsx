import { expect, test } from "bun:test";
import { SelectRenderable, TabSelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerResources,
  readerSecondAddress,
} from "./installed-reader.fixture";

test("RENDER Resource content pointer activation switches Reader independently of custom loaded payload", async () => {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => {
            loads.push(request.address.path);
            return {
              value:
                request.address.path === readerSecondAddress.path
                  ? {
                      address: readerSecondAddress,
                      name: "reference",
                      description: "custom",
                      rawText: "",
                      markdownText: "",
                    }
                  : readerContent,
              diagnostics: [],
            };
          },
          listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
          readInstalled: async (request) => ({
            value: {
              kind: "text" as const,
              path: request.path,
              text: "resource body",
              format: "text" as const,
            },
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    setup.mockInput.pressKey("ARROW_RIGHT");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("resource body"));

    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    expect(browser).toBeInstanceOf(SelectRenderable);
    await setup.mockMouse.click(browser!.screenX, browser!.screenY + 2);
    await setup.renderOnce();
    expect(
      (
        setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
      ).getSelectedOption()?.value,
    ).toBe("team-main/reference");
    await setup.waitFor(() => loads.includes("reference"));
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    expect(
      (
        setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
      ).getSelectedIndex(),
    ).toBe(0);
    await setup.mockMouse.click(browser!.screenX, browser!.screenY + 1);
    expect((browser as SelectRenderable).getSelectedOption()?.value).toBe("team-main/guide");
    await setup.waitFor(() => loads.filter((path) => path === "guide").length === 2);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
  } finally {
    setup.renderer.destroy();
  }
});
