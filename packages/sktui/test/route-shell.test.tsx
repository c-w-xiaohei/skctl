/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { Button } from "../src/ui/button";
import { ButtonRenderable } from "@tuiparts/core/button";
import { MetadataGrid } from "../src/ui/metadata-grid";
import { Pane } from "../src/ui/pane";
import { RouteShell } from "../src/ui/route-shell";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

test("a too-small RouteShell mounts only the resize gate", async () => {
  setup = await testRender(
    () => (
      <RouteShell
        mode="too-small"
        columns={50}
        slots={{
          scopeControls: <text>Scope</text>,
          activity: <text>Activity</text>,
          back: <text>Back</text>,
          breadcrumbs: <text>Skills</text>,
          pageNavigation: <text>Pages</text>,
          content: <text>Content</text>,
          commandStatus: <text>Status</text>,
        }}
      />
    ),
    { width: 50, height: 12 },
  );
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  for (const id of ["global-bar", "section-nav", "route-title", "route-content", "command-status"])
    expect(!!setup.renderer.root.findDescendantById(id)).toBe(false);
  expect(setup.renderer.root.findDescendantById("resize-gate")).toBeDefined();
  expect(frame).not.toContain("Content");
});

test.each([
  [43, 13],
  [80, 24],
  [100, 24],
  [144, 40],
])("shell keeps navigation visible and activity below content at %ix%i", async (width, height) => {
  setup = await testRender(
    () => (
      <RouteShell
        mode={width >= 100 ? "wide" : "narrow"}
        columns={width}
        slots={{
          scopeControls: <Button id="actions" label="Actions" />,
          activity: <text>Checking</text>,
          back: <Button id="back" label="Back" shortcutHint="Esc" />,
          breadcrumbs: <text id="breadcrumbs">Skills › guide</text>,
          pageNavigation: <Button id="pages" label="Pages" />,
          content: <text>Workspace</text>,
          commandStatus: <text>Enter open</text>,
        }}
      />
    ),
    { width, height },
  );
  await setup.renderOnce();
  const node = (id: string) => setup!.renderer.root.findDescendantById(id)!;
  const chrome = height < 24 ? 1 : 2;
  expect(node("global-bar").height).toBe(chrome);
  expect(node("pages").screenY).toBe(0);
  expect(node("back").screenY).toBe(chrome);
  expect(node("actions").screenY).toBe(0);
  expect(node("breadcrumbs").screenY).toBe(chrome);
  expect(node("breadcrumbs").screenX).toBeLessThan(node("back").screenX);
  expect(node("route-content").screenY).toBe(chrome + 1);
  expect(node("workarea-navigation-pane").width).toBe(width - 2);
  expect(node("shell-activity").screenY).toBe(height - 1);
  expect(node("command-status").screenY).toBe(height - 1);
  for (const id of ["pages", "back", "actions", "shell-activity", "command-status"]) {
    expect(node(id).screenX + node(id).width).toBeLessThanOrEqual(width);
  }
  const pages = node("pages") as ButtonRenderable;
  pages.focus();
  setup.resize(width, 13);
  await setup.flush();
  expect(node("global-bar").height).toBe(1);
  expect(setup.renderer.currentFocusedRenderable).toBe(pages);
  expect(node("shell-activity").screenY).toBe(12);
});

test("shared native buttons retain disabled and focus state beside metadata", async () => {
  setup = await testRender(
    () => (
      <Pane id="details" title="Details" active>
        <MetadataGrid
          fields={[
            { label: "Owner", value: "Project", wrap: "word" },
            {
              label: "Defined at",
              value: "/workspace/config.jsonc",
              wrap: "word",
            },
          ]}
        />
        <Button id="open" label="Open" />
        <Button id="focus" label="Focus" />
        <Button id="unavailable" label="Unavailable" disabled />
        <Button id="remove" label="Remove" intent="danger" />
      </Pane>
    ),
    { width: 60, height: 10 },
  );
  await setup.renderOnce();
  await setup.waitForFrame((frame) => frame.includes("Project"));
  expect(setup.captureCharFrame()).toContain("/workspace/config.jsonc");
  for (const id of ["open", "focus", "unavailable", "remove"])
    expect(setup.renderer.root.findDescendantById(id)).toBeInstanceOf(ButtonRenderable);
  const focused = setup.renderer.root.findDescendantById("focus") as ButtonRenderable;
  focused.focus();
  expect(focused.getState().focused).toBe(true);
  expect(
    (setup.renderer.root.findDescendantById("unavailable") as ButtonRenderable).getState().disabled,
  ).toBe(true);
  expect(setup.renderer.root.findDescendantById("details")).toBeDefined();
});

test("short panes put their title inside one line and retain eight content rows", async () => {
  setup = await testRender(
    () => (
      <Pane id="reader" title="Instructions">
        <box id="body" flexGrow={1} minHeight={0}>
          <text>{Array.from({ length: 8 }, (_, i) => `Instruction ${i + 1}`).join("\n")}</text>
        </box>
      </Pane>
    ),
    { width: 43, height: 9 },
  );
  await setup.renderOnce();
  const body = setup.renderer.root.findDescendantById("body")!;
  expect(body.screenY).toBe(1);
  expect(body.height).toBe(8);
  expect(setup.captureCharFrame()).toContain("Instruction 8");
});
