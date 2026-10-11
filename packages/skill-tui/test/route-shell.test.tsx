/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { CommandButton } from "../src/ui/command-button";
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
        slots={{
          globalBar: <text>Global</text>,
          sectionNav: <text>Section</text>,
          routeTitle: <text>Title</text>,
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
  expect(frame).toContain("Terminal is too small.");
  expect(frame).not.toContain("Content");
});

test("CommandButton states and MetadataGrid fields expose structural-only cues", async () => {
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
        <CommandButton label="Open" state="idle" />
        <CommandButton label="Focus" state="focused" />
        <CommandButton label="Unavailable" state="disabled" />
        <CommandButton label="Remove" state="danger" destination="Review removal" />
      </Pane>
    ),
    { width: 60, height: 10 },
  );
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("* Details");
  expect(frame).toContain("Owner  Project");
  expect(frame).toContain("Defined at  /workspace/config.jsonc");
  expect(frame).toContain("{Open}");
  expect(frame).toContain(">Focus<");
  expect(frame).toContain("- Unavailable");
  expect(frame).toContain("{DANGER Remove -> Review removal}");
  expect(setup.renderer.root.findDescendantById("details")).toBeDefined();
});
