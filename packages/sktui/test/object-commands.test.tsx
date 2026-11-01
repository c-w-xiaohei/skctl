/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import {
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  TextRenderable,
  parseColor,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { ButtonRenderable } from "@tuiparts/core/button";
import { CommandPalette } from "../src/command-palette";
import { Button } from "../src/ui/button";
import { theme } from "../src/ui/theme";
import type { CommandRecord } from "../src/types";

const command = (overrides: Partial<CommandRecord>): CommandRecord => ({
  id: "current",
  verb: "Check updates",
  destination: "Review form",
  keys: ["enter"],
  scope: "page",
  enabled: true,
  danger: false,
  ...overrides,
});

test("Actions groups real commands and distinguishes their object, scope, and opened screen", async () => {
  const invoked: string[] = [];
  const actions = [
    command({
      id: "navigation",
      verb: "Open Sources",
      destination: "Sources",
      group: "navigation",
    }),
    command({
      id: "batch",
      verb: "Update checked",
      object: "3 Skills",
      scopeText: "3 checked Skills",
      opens: "Review form",
      group: "batch",
    }),
    command({
      id: "member",
      verb: "Remove member",
      object: "team/guide",
      scopeText: "Collection team",
      opens: "Removal review",
      group: "member",
    }),
    command({
      object: "source-one/guide",
      scopeText: "Installed Skill",
      opens: "Review form",
      group: "current",
    }),
  ];
  const setup = await testRender(
    () => (
      <CommandPalette
        open
        actions={actions}
        onSelect={(record) => invoked.push(record.id)}
        onClose={() => {}}
      />
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    expect(choices.options.map((option) => option.value.id)).toEqual([
      "current",
      "member",
      "batch",
      "navigation",
    ]);
    const groups = choices.options.map((option) => option.name);
    expect(groups[0]).toMatch(/current/i);
    expect(groups[1]).toMatch(/member/i);
    expect(groups[2]).toMatch(/(batch|checked)/i);
    expect(groups[3]).toMatch(/(navigation|go to)/i);
    await setup.renderOnce();
    const detail = () =>
      ["palette-action-detail", "palette-action-reason"]
        .map((id) => (setup.renderer.root.findDescendantById(id) as TextRenderable).plainText)
        .join(" ");
    expect(detail()).toContain("source-one/guide");
    expect(detail()).toContain("Installed Skill");
    expect(detail()).toMatch(/Opens:.*Review form/i);
    expect(detail()).not.toMatch(/Target:\s*Review form/i);
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(detail()).toContain("team/guide");
    expect(detail()).toContain("Collection team");
    expect(detail()).toMatch(/Opens:.*Removal review/i);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(invoked).toEqual(["member"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("native Actions search finds objects and navigation destinations without inventing targets", async () => {
  const actions = [
    command({
      object: "source-one/guide",
      scopeText: "Installed Skill",
      opens: "Review form",
      group: "current",
    }),
    command({
      id: "navigation",
      verb: "Open Sources",
      destination: "Sources",
      group: "navigation",
    }),
  ];
  const setup = await testRender(
    () => <CommandPalette open actions={actions} onSelect={() => {}} onClose={() => {}} />,
    { width: 80, height: 24, kittyKeyboard: true },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    setup.mockInput.pressKey("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-query");
    expect(setup.renderer.currentFocusedRenderable instanceof InputRenderable).toBe(true);
    await setup.mockInput.typeText("source-one/guide");
    await setup.renderOnce();
    const choices = setup.renderer.root.findDescendantById("palette-choices") as SelectRenderable;
    expect(choices.options.map((option) => option.value.id)).toEqual(["current"]);
    await setup.mockInput.pressKeys(
      Array.from({ length: "source-one/guide".length }, () => "BACKSPACE"),
    );
    expect((setup.renderer.currentFocusedRenderable as InputRenderable).value).toBe("");
    await setup.mockInput.typeText("Sources");
    await setup.renderOnce();
    expect(choices.options.map((option) => option.value.id)).toEqual(["navigation"]);
    const details = ["palette-action-detail", "palette-action-reason"]
      .map((id) => (setup.renderer.root.findDescendantById(id) as TextRenderable).plainText)
      .join(" ");
    expect(details).toContain("Sources");
    expect(details).not.toMatch(/(Target|Object):\s*Sources/i);
  } finally {
    setup.renderer.destroy();
  }
});

test("annotated groups remain contiguous among ordinary task commands regardless of priority", async () => {
  const actions = [
    command({ id: "member-late", verb: "Remove member", group: "member", priority: 90 }),
    command({ id: "ordinary", verb: "Stop work", scope: "task", priority: 50 }),
    command({ id: "member-early", verb: "Read member", group: "member", priority: 10 }),
    command({ id: "current", group: "current", priority: 50 }),
  ];
  const setup = await testRender(
    () => <CommandPalette open actions={actions} onSelect={() => {}} onClose={() => {}} />,
    { width: 100, height: 24 },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const ids = choices.options.map((option) => option.value.id);
    expect(ids.indexOf("member-late") - ids.indexOf("member-early")).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("unannotated command description is never presented as an opened screen or object", async () => {
  const action = command({
    id: "stop",
    verb: "Stop",
    destination: "Request running work to settle",
    scope: "task",
    enabled: false,
    disabledReason: "No work is running",
  });
  const invoked: string[] = [];
  const setup = await testRender(
    () => (
      <CommandPalette
        open
        actions={[action]}
        onSelect={(record) => invoked.push(record.id)}
        onClose={() => {}}
      />
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    await setup.renderOnce();
    const detail = (
      setup.renderer.root.findDescendantById("palette-action-detail") as TextRenderable
    ).plainText;
    const reason = (
      setup.renderer.root.findDescendantById("palette-action-reason") as TextRenderable
    ).plainText;
    expect(detail).not.toMatch(/(Opens|Object|Target):/i);
    expect(reason).toBe("No work is running");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(invoked).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test.each(["dark", "light"] as const)(
  "button intents and focus retain distinct native faces in %s theme",
  async (mode) => {
    theme.setMode(mode);
    const setup = await testRender(
      () => (
        <box flexDirection="row" gap={1}>
          <Button id="quiet" label="Quiet" intent="quiet" />
          <Button id="neutral" label="Open" intent="neutral" />
          <Button id="primary" label="Apply" intent="primary" />
          <Button id="danger" label="Remove" intent="danger" />
        </box>
      ),
      { width: 80, height: 8 },
    );
    try {
      await setup.renderOnce();
      const button = (id: string) => setup.renderer.root.findDescendantById(id)!;
      const face = (id: string) => (button(id).getChildren()[0] as BoxRenderable).backgroundColor;
      const color = (id: string) => {
        const c = parseColor(face(id));
        return [c.r, c.g, c.b, c.a].join(",");
      };
      for (const id of ["quiet", "neutral", "primary", "danger"]) {
        expect(button(id) instanceof ButtonRenderable).toBe(true);
        expect(parseColor(face(id)).a).toBe(1);
      }
      expect(
        new Set([color("quiet"), color("neutral"), color("primary"), color("danger")]).size,
      ).toBe(4);
      const primary = color("primary");
      await setup.mockMouse.click(button("neutral").screenX + 1, button("neutral").screenY);
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("neutral");
      expect(color("neutral")).not.toBe(primary);
      expect(setup.captureCharFrame()).toContain("›Open");
    } finally {
      setup.renderer.destroy();
      theme.setMode("system");
    }
  },
);
