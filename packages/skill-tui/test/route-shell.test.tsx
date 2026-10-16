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

test("shared native buttons retain disabled and focus state beside metadata", async () => {
  setup = await testRender(
    () => (
      <Pane id="details" title="Details" active>
        <MetadataGrid
          fields={[
            { label: "Owner", value: "Project", priority: 1, wrap: "word", narrow: "stack" },
            {
              label: "Defined at",
              value: "/workspace/config.jsonc",
              priority: 2,
              wrap: "path",
              narrow: "description",
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
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Project");
  expect(frame).toContain("/workspace/config.jsonc");
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
