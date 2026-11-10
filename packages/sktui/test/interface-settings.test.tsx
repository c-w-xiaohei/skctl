import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { InputRenderable } from "@opentui/core";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPreferences } from "../src/preferences";
import { InterfaceSettings } from "../src/interface-settings";
import { createFocusRegistry } from "../src/focus";
import { createCommandRegistry } from "../src/commands";
import { enterLive, focusLive } from "./reader-test-controls";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { openMainPage } from "./main-page-controls";
import { openSettingsCategory } from "./settings-test-controls";

test("Settings exposes user preferences outside declaration Scope", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 100, height: 24 },
  );
  try {
    await openMainPage(setup, "settings");
    await openSettingsCategory(setup, "interface");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("interface-browser-width"));
    expect(!!setup.renderer.root.findDescendantById("shell-scope-select")).toBe(false);
    await openSettingsCategory(setup, "sources");
    expect(!!setup.renderer.root.findDescendantById("shell-scope-select")).toBe(true);
    expect(!!setup.renderer.root.findDescendantById("interface-browser-width")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("Interface displays a saved width loaded after the form mounts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sktui-interface-load-"));
  const file = join(directory, "preferences.json");
  await writeFile(file, JSON.stringify({ version: 1, browserWidthColumns: 57 }));
  let preferences!: ReturnType<typeof createPreferences>;
  const setup = await testRender(
    () => {
      preferences = createPreferences(file);
      return (
        <InterfaceSettings
          preferences={preferences}
          actualWidth={38}
          wide
          focusRegistry={createFocusRegistry()}
          registerCommand={createCommandRegistry(() => []).register}
        />
      );
    },
    { width: 80, height: 24 },
  );
  try {
    await preferences.load();
    await setup.flush();
    expect(
      (setup.renderer.root.findDescendantById("interface-browser-width") as InputRenderable).value,
    ).toBe("57");
  } finally {
    setup.renderer.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Interface saves a previewed width and Cancel restores the saved preference", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sktui-interface-"));
  const file = join(directory, "preferences.json");
  const setup = await testRender(
    () => {
      const preferences = createPreferences(file);
      const commands = createCommandRegistry(() => []);
      return (
        <InterfaceSettings
          preferences={preferences}
          actualWidth={38}
          wide
          focusRegistry={createFocusRegistry()}
          registerCommand={commands.register}
        />
      );
    },
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    await focusLive(setup, "interface-browser-width");
    setup.mockInput.pressKey("END");
    await setup.renderOnce();
    setup.mockInput.pressKey("BACKSPACE");
    await setup.renderOnce();
    setup.mockInput.pressKey("BACKSPACE");
    await setup.renderOnce();
    await setup.mockInput.typeText("52");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("52");
    await enterLive(setup, "interface-save");
    await setup.waitFor(async () => Bun.file(file).exists());
    expect(JSON.parse(await readFile(file, "utf8")).browserWidthColumns).toBe(52);
    await enterLive(setup, "interface-reset");
    await enterLive(setup, "interface-cancel");
    expect(setup.captureCharFrame()).not.toContain("Unsaved changes");
    expect(JSON.parse(await readFile(file, "utf8")).browserWidthColumns).toBe(52);
  } finally {
    setup.renderer.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

test("App Interface reaches Save by Tab and persists the preview without changing declaration scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sktui-interface-app-"));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 100, height: 24 },
  );
  try {
    await openMainPage(setup, "settings");
    await openSettingsCategory(setup, "interface");
    await focusLive(setup, "interface-browser-width");
    setup.mockInput.pressKey("END");
    await setup.flush();
    setup.mockInput.pressKey("BACKSPACE");
    setup.mockInput.pressKey("BACKSPACE");
    await setup.flush();
    await setup.mockInput.typeText("44");
    await setup.flush();
    setup.mockInput.pressKey("TAB");
    await setup.flush();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "interface-save");
    await enterLive(setup, "interface-save");
    const file = join(directory, "skctl", "tui-preferences.json");
    await setup
      .waitFor(
        async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          return Bun.file(file).exists();
        },
        { maxPasses: 200 },
      )
      .catch((error) => {
        throw new Error(`${file}\n${setup.captureCharFrame()}`, { cause: error });
      });
    expect(JSON.parse(await readFile(file, "utf8")).browserWidthColumns).toBe(44);
    expect(!!setup.renderer.root.findDescendantById("shell-scope-select")).toBe(false);
  } finally {
    setup.renderer.destroy();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
