import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import { readerContent, readerProjection, readerResources } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEscape,
} from "./reader-test-controls";

test("search owns printable keys and Ctrl+C without quitting or changing route", async () => {
  let exits = 0;
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => exits++} />,
    { width: 120, height: 40, exitOnCtrlC: false },
  );
  try {
    await openAllInstalledSkills(setup);
    await focusLive(setup, "skills-query");
    await setup.mockInput.typeText("q /");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
    setup.mockInput.pressCtrlC();
    await setup.renderOnce();
    expect(exits).toBe(0);
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "q /",
    );
    await parsedEscape(setup);
    expect(!!setup.renderer.root.findDescendantById("source-register-id")).toBe(false);
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
  } finally {
    setup.renderer.destroy();
  }
});

test("palette owns arrows, Tab, q and Escape without delivering them to the page", async () => {
  let exits = 0;
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => exits++} />,
    { width: 120, height: 40 },
  );
  try {
    const browser = await openAllInstalledSkills(setup);
    const selected = browser.getSelectedOption()?.value;
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.workspace",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressKey("q");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.global",
    );
    expect(exits).toBe(0);
    expect(browser.getSelectedOption()?.value).toBe(selected);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
  } finally {
    setup.renderer.destroy();
  }
});

test("Escape leaves resource content before returning from Reader", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
          listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
          readInstalled: async (request) => ({
            value: { kind: "text", path: request.path, text: "Resource body", format: "text" },
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await openReaderFromInspector(setup);
    await openReaderTab(setup, 1);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
    const browser = (await focusLive(setup, "resource-browser")) as SelectRenderable;
    browser.setSelectedIndex(readerResources.findIndex((resource) => resource.kind === "file"));
    await enterLive(setup, "resource-browser");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
    expect(!!setup.renderer.root.findDescendantById("reader-views")).toBe(true);
    expect(!!setup.renderer.root.findDescendantById("resource-content")).toBe(false);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
  } finally {
    setup.renderer.destroy();
  }
});
