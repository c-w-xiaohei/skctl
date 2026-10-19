/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keyboardGuidance } from "../src/keyboard-guidance";
import { CommandPalette } from "../src/command-palette";
import type { CommandRecord } from "../src/types";

const record = (verb: string): CommandRecord => ({
  id: "source.open",
  verb,
  destination: "team/source",
  scope: "page",
  keys: ["enter"],
  enabled: true,
  danger: false,
});

test.each([
  "Open Source",
  "Back to Contents",
  "Review changing the selected Config Source binding",
])("narrow command guidance keeps Actions discoverable for %s", (verb) => {
  const hint = keyboardGuidance({ mode: "command", width: 41, command: record(verb) });
  expect(hint.local.startsWith("Enter ")).toBe(true);
  expect(hint.global).toMatch(/(?:Ctrl\+P|\^P) Actions/);
  expect(Bun.stringWidth(hint.local) + 3 + Bun.stringWidth(hint.global)).toBeLessThanOrEqual(41);
  if (verb === "Back to Contents") expect(hint.local).toBe("Enter Back to Contents");
});

test("narrow text-entry and modal guidance keeps the real Escape meaning without advertising unavailable Actions", () => {
  for (const [mode, modal, modalBack] of [
    ["edit", false, undefined],
    ["command", true, "options"],
  ] as const) {
    const hint = keyboardGuidance({
      mode,
      width: 41,
      modal,
      modalBack,
      command: record("Review changing the selected Config Source binding"),
    });
    expect(hint.global).toContain(modal ? "Esc options" : "Esc cancel");
    expect(hint.global).not.toMatch(/(?:Ctrl\+P|\^P) Actions/);
    expect(
      Bun.stringWidth(hint.local) + (hint.local ? 3 : 0) + Bun.stringWidth(hint.global),
    ).toBeLessThanOrEqual(41);
  }
});

async function capture(setup: Awaited<ReturnType<typeof testRender>>, name: string) {
  const directory = process.env.PAGE_INTERACTION_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.txt`), setup.captureCharFrame());
  await writeFile(join(directory, `${name}.json`), JSON.stringify(setup.captureSpans(), null, 2));
}

test.each([
  [80, 24],
  [43, 13],
])(
  "long Actions targets and reasons have native keyboard reading at %ix%i",
  async (width, height) => {
    const [open, setOpen] = createSignal(false);
    const [actions, setActions] = createSignal<readonly CommandRecord[]>([
      {
        ...record("Forget Adopted Config"),
        id: "config.forget",
        enabled: false,
        danger: true,
        destination:
          "project /workspace/team/project/skctl.jsonc /configSources/explicit-owner-target",
        disabledReason:
          "Wait for the current operation to settle before changing this exact Config Source; no mutation was submitted.",
      },
    ]);
    const invocations: string[] = [];
    const setup = await testRender(
      () => (
        <>
          <input id="origin" focused value="retained draft" />
          <CommandPalette
            open={open()}
            actions={actions()}
            onSelect={(action) => invocations.push(action.id)}
            onClose={() => setOpen(false)}
          />
        </>
      ),
      { width, height, kittyKeyboard: true },
    );
    try {
      await setup.flush();
      const origin = setup.renderer.root.findDescendantById("origin")!;
      setOpen(true);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      await setup.flush();
      const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
      const details = setup.renderer.root.findDescendantById("palette-command-details");
      expect(details).toBeInstanceOf(ScrollBoxRenderable);
      const reading = details as ScrollBoxRenderable;
      expect(reading.scrollHeight).toBeGreaterThan(reading.viewport.height);
      expect(reading.focusable).toBe(true);
      setup.mockInput.pressTab();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === reading);
      setup.mockInput.pressKey("END");
      await setup.flush();
      expect(reading.scrollTop).toBeGreaterThan(0);
      expect(
        setup
          .captureCharFrame()
          .replace(/[│\n]/g, " ")
          .replace(/\s+/g, " "),
      ).toContain("no mutation was submitted.");
      await capture(setup, `actions-reason-${width}x${height}`);
      setup.mockInput.pressKey("HOME");
      await setup.flush();
      expect(reading.scrollTop).toBe(0);
      expect(setup.captureCharFrame()).toContain("Target: project");
      await capture(setup, `actions-target-${width}x${height}`);
      await setup.mockMouse.scroll(reading.screenX + 2, reading.screenY, "down");
      await setup.flush();
      expect(reading.scrollTop).toBeGreaterThan(0);
      expect(choices.getSelectedOption()?.value.id).toBe("config.forget");
      const nextWidth = width === 80 ? 43 : 80;
      const nextHeight = width === 80 ? 13 : 24;
      setup.resize(nextWidth, nextHeight);
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable).toBe(reading);
      expect(reading.screenX).toBeGreaterThanOrEqual(0);
      expect(reading.screenY + reading.height).toBeLessThan(nextHeight);
      expect(choices.getSelectedOption()?.value.id).toBe("config.forget");
      await capture(setup, `actions-reading-resized-to-${nextWidth}x${nextHeight}`);
      setup.mockInput.pressEnter();
      await setup.flush();
      expect(invocations).toEqual([]);
      expect(choices.getSelectedOption()?.value.id).toBe("config.forget");
      setActions([record("Short action")]);
      await setup.flush();
      expect(reading.focusable).toBe(false);
      expect(setup.renderer.currentFocusedRenderable).toBe(choices);
      setup.mockInput.pressTab();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-close");
      setup.mockInput.pressEscape();
      await setup.waitFor(() => !open() && setup.renderer.currentFocusedRenderable === origin);
      expect(invocations).toEqual([]);
    } finally {
      setup.renderer.destroy();
    }
  },
);
