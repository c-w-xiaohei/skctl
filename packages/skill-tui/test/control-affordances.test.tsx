/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import {
  BoxRenderable,
  InputRenderable,
  parseColor,
  type ColorInput,
  type RGBA,
  type Renderable,
} from "@opentui/core";
import { ButtonRenderable } from "@tuiparts/core/button";
import { testRender } from "@opentui/solid";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Button } from "../src/ui/button";
import { Input } from "../src/ui/input";
import { theme } from "../src/ui/theme";
import { App } from "../src/app";
import { SourceObservationOverlay } from "../src/operations";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  type ReaderSetup,
} from "./reader-test-controls";

afterEach(() => {
  theme.override(undefined);
  theme.setMode("system");
});
function palette(mode: "dark" | "light") {
  theme.setMode(mode);
  theme.override({
    colors: {
      background: mode === "dark" ? "#1b2025" : "#f4f6f8",
      foreground: mode === "dark" ? "#e8eef5" : "#142435",
    },
  });
}
const rgba = (color: ColorInput) => {
  const value = parseColor(color);
  return [value.r, value.g, value.b, value.a];
};
const face = (button: Renderable) => button.getChildren()[0] as BoxRenderable;
function cell(setup: ReaderSetup, x: number, y: number) {
  let offset = 0;
  for (const span of setup.captureSpans().lines[y]!.spans) {
    offset += span.width;
    if (x < offset) return span;
  }
  throw new Error(`No rendered cell at ${x},${y}`);
}
function contrast(a: RGBA, b: RGBA) {
  const luminance = (color: RGBA) =>
    [color.r, color.g, color.b]
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  const values = [luminance(a), luminance(b)].sort((left, right) => left - right);
  return (values[1]! + 0.05) / (values[0]! + 0.05);
}
async function capture(setup: ReaderSetup, name: string) {
  const directory = process.env.OPERATE_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.txt`), setup.captureCharFrame());
  await writeFile(join(directory, `${name}.json`), JSON.stringify(setup.captureSpans(), null, 2));
}

test.each(["dark", "light"] as const)(
  "unfocused command faces stay recognizable on canvas and popup in %s mode",
  async (mode) => {
    palette(mode);
    const setup = await testRender(
      () => (
        <box backgroundColor={theme.get().colors.surface} flexDirection="row" gap={1}>
          <Button id="default" label="Default" />
          <Button id="neutral" label="Open Source" intent="neutral" />
          <Button id="quiet" label="Open Config" intent="quiet" />
          <Button id="danger" label="Remove" intent="danger" />
          <Button id="primary" label="Apply" intent="primary" />
          <Button id="disabled" label="Unavailable" disabled />
        </box>
      ),
      { width: 100, height: 8 },
    );
    try {
      await setup.flush();
      for (const id of ["default", "neutral", "quiet", "danger", "primary", "disabled"]) {
        const button = live(setup, id);
        expect(button).toBeInstanceOf(ButtonRenderable);
        expect(face(button).backgroundColor.a).toBe(1);
        expect(rgba(face(button).backgroundColor)).not.toEqual(rgba(theme.get().colors.background));
        expect(rgba(face(button).backgroundColor)).not.toEqual(rgba(theme.get().colors.surface));
        const label = cell(setup, button.screenX + 1, button.screenY);
        expect(contrast(label.fg, label.bg)).toBeGreaterThanOrEqual(4.5);
        for (let x = button.screenX; x < button.screenX + button.width; x++)
          expect(rgba(cell(setup, x, button.screenY).bg)).toEqual(
            rgba(face(button).backgroundColor),
          );
      }
      expect(rgba(face(live(setup, "default")).backgroundColor)).toEqual(
        rgba(face(live(setup, "neutral")).backgroundColor),
      );
      await capture(setup, `buttons-${mode}`);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("button focus, press and disabled semantics keep the same compact hit target", async () => {
  palette("dark");
  let presses = 0;
  const setup = await testRender(
    () => (
      <box flexDirection="row" gap={1}>
        <Button
          id="command"
          label="Open Source"
          intent="quiet"
          onPress={() => {
            presses++;
          }}
        />
        <Button
          id="disabled"
          label="Unavailable"
          disabled
          onPress={() => {
            presses++;
          }}
        />
      </box>
    ),
    { width: 60, height: 8 },
  );
  try {
    await setup.flush();
    const button = live(setup, "command");
    const bounds = [button.width, button.height];
    const idle = rgba(face(button).backgroundColor);
    await focusLive(setup, "command");
    await setup.flush();
    expect(rgba(face(button).backgroundColor)).not.toEqual(idle);
    expect([button.width, button.height]).toEqual(bounds);
    await setup.mockMouse.pressDown(button.screenX + 1, button.screenY);
    await setup.flush();
    expect(presses).toBe(0);
    const pressed = rgba(face(button).backgroundColor);
    await setup.mockMouse.release(button.screenX + 1, button.screenY);
    await setup.flush();
    expect(presses).toBe(1);
    expect(rgba(face(button).backgroundColor)).not.toEqual(pressed);
    const unavailable = live(setup, "disabled");
    await setup.mockMouse.click(unavailable.screenX + 1, unavailable.screenY);
    expect(presses).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test.each(["dark", "light"] as const)(
  "editable fields and operation covers follow the %s theme",
  async (mode) => {
    palette(mode);
    const setup = await testRender(
      () => (
        <box>
          <Input id="field" width={24} placeholder="Collection ID" />
          <SourceObservationOverlay
            title="Observing Config"
            source="team"
            cancelling={false}
            onRetry={() => {}}
            onClose={() => {}}
          />
        </box>
      ),
      { width: 80, height: 24 },
    );
    try {
      await setup.flush();
      const cover = live(setup, "source-observation-overlay") as BoxRenderable;
      expect(rgba(cover.backgroundColor)).toEqual(rgba(theme.get().colors.background));
      const field = live(setup, "field") as InputRenderable;
      expect(parseColor(field.backgroundColor).a).toBe(1);
      expect(rgba(field.backgroundColor)).not.toEqual(rgba(theme.get().colors.background));
      palette(mode === "dark" ? "light" : "dark");
      await setup.flush();
      expect(rgba(cover.backgroundColor)).toEqual(rgba(theme.get().colors.background));
      await capture(setup, `operation-cover-${mode}`);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.each(["dark", "light"] as const)(
  "native text entry has visible idle and focused surfaces in %s mode",
  async (mode) => {
    palette(mode);
    const setup = await testRender(
      () => <Input id="entry" width={24} placeholder="Collection ID" />,
      { width: 40, height: 8 },
    );
    try {
      await setup.flush();
      const entry = live(setup, "entry") as InputRenderable;
      const idle = cell(setup, entry.screenX + 1, entry.screenY);
      expect(rgba(idle.bg)).toEqual(rgba(theme.get().colors.input));
      expect(contrast(idle.fg, idle.bg)).toBeGreaterThanOrEqual(4.5);
      await focusLive(setup, entry.id);
      await setup.flush();
      const focused = cell(setup, entry.screenX + 1, entry.screenY);
      expect(rgba(focused.bg)).toEqual(rgba(theme.get().colors.control));
      expect(rgba(focused.bg)).not.toEqual(rgba(idle.bg));
      await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
      await setup.flush();
      expect(entry.value).toBe("team");
      await capture(setup, `input-${mode}`);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])(
  "production Reader relationships and disclosures remain recognizable at %ix%i",
  async (width, height) => {
    palette("dark");
    await mkdir("/tmp/opencode", { recursive: true });
    const cache = await mkdtemp("/tmp/opencode/operate-controls-");
    const previous = process.env.SKILL_TUI_UPDATE_CACHE_DIR;
    process.env.SKILL_TUI_UPDATE_CACHE_DIR = cache;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
          })}
          exit={() => {}}
        />
      ),
      { width, height },
    );
    try {
      await openAllInstalledSkills(setup);
      await parsedEnter(setup);
      await openReaderTab(setup, 2);
      await setup.flush();
      const source = live(setup, "reader-details-relationship-source");
      expect(face(source).backgroundColor.a).toBe(1);
      const row = source.parent!.parent!.parent!;
      const target = row.getChildren().at(-1)!;
      const pane = live(setup, "reader-pane");
      if (pane.width < 48) expect(target.screenY).toBeGreaterThan(source.screenY);
      else expect(target.screenY).toBe(source.screenY);
      await focusLive(setup, source.id);
      await setup.flush();
      await capture(setup, `connections-${width}x${height}`);
      await focusLive(setup, "reader-details-manage");
      await setup.flush();
      const trigger = live(setup, "reader-details-manage");
      expect(trigger.screenY).toBeGreaterThan(pane.screenY);
      expect(trigger.screenY + trigger.height).toBeLessThan(pane.screenY + pane.height);
      const focused = cell(setup, trigger.screenX + 2, trigger.screenY);
      expect(rgba(focused.bg)).toEqual(rgba(theme.get().colors.primary));
      await enterLive(setup, "reader-details-manage");
      await focusLive(setup, "reader-reload");
      await setup.flush();
      await capture(setup, `reader-${width}x${height}`);
      expect(live(setup, "reader-details-relationship-source")).toBe(source);
    } finally {
      setup.renderer.destroy();
      if (previous === undefined) delete process.env.SKILL_TUI_UPDATE_CACHE_DIR;
      else process.env.SKILL_TUI_UPDATE_CACHE_DIR = previous;
      await rm(cache, { recursive: true, force: true });
    }
  },
);
