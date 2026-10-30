import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { IntegrationsPage } from "../src/integrations/page";
import { createIntegrationsState, type IntegrationsApi } from "../src/integrations/state";
import { createFocusRegistry } from "../src/focus";
import { createPanelNavigation } from "../src/panel-navigation";
import type { MutationRequest } from "@skctl/integrations";
import { enterLive, focusLive } from "./reader-test-controls";

test.each([
  [100, 30],
  [43, 13],
])("shared-file disconnect can be cancelled and confirmed at %ix%i", async (width, height) => {
  const changes: MutationRequest[] = [];
  const registry = createFocusRegistry();
  const api: IntegrationsApi = {
    inspect: async (target) => ({
      target,
      recommended: "default",
      selectionReason: "Instruction file",
      cli: "/bin/skctl",
      revision: "reviewed",
      entries: [
        {
          file: "/project/AGENTS.md",
          mechanism: "default",
          inherited: false,
          status: "current",
          selected: "selected",
        },
      ],
      candidates: [],
      diagnostics: [],
      nextSteps: [],
    }),
    connect: async () => {
      throw new Error("Unexpected connect");
    },
    disconnect: async (request) => {
      changes.push(request);
      return {
        action: "disconnect",
        mechanism: "default",
        outcome: request.acknowledgeFileImpact ? "applied" : "blocked",
        diagnostics: request.acknowledgeFileImpact
          ? []
          : [{ code: "FILE_IMPACT_CONFIRMATION", message: "Affects all readers of this file" }],
      };
    },
  };
  const setup = await testRender(
    () => {
      const state = createIntegrationsState(api);
      return (
        <box id="route-shell">
          <IntegrationsPage
            state={state}
            scope="project"
            directory="/project"
            focusRegistry={registry}
          />
        </box>
      );
    },
    { width, height },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
    await enterLive(setup, "integration-disconnect");
    await setup.waitForFrame((frame) => frame.includes("Confirm disconnect"));
    expect(changes).toHaveLength(1);
    const confirm = setup.renderer.root.findDescendantById("integration-confirm")!;
    expect(confirm.screenY + confirm.height).toBeLessThanOrEqual(height);
    await focusLive(setup, "integration-keep");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(changes).toHaveLength(1);
    await enterLive(setup, "integration-keep");
    await enterLive(setup, "integration-disconnect");
    await enterLive(setup, "integration-confirm");
    await setup.waitFor(() => changes.length === 3);
    expect(changes[2]).toEqual({ ...changes[1], acknowledgeFileImpact: true });
    await setup.waitForFrame((frame) => frame.includes("applied"));
    expect(!!setup.renderer.root.findDescendantById("integration-confirm")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("integration panels expose hosts, actions and selectable concrete entries to keyboard traversal", async () => {
  const registry = createFocusRegistry();
  let state: ReturnType<typeof createIntegrationsState>;
  const api: IntegrationsApi = {
    inspect: async (target) => ({
      target,
      recommended: "codex-hooks",
      selectionReason: "fixture",
      entries: [
        {
          mechanism: "codex-hooks",
          file: "/project/.codex/hooks.json",
          status: "current",
          inherited: false,
          selected: "unknown",
        },
        {
          mechanism: "codex-hooks",
          file: "/project/.codex/config.toml",
          status: "current",
          inherited: false,
          selected: "unknown",
        },
      ],
      candidates: [],
      revision: "1",
      cli: "/bin/skctl",
      diagnostics: [],
      nextSteps: [],
    }),
    connect: async () => {
      throw new Error("not used");
    },
    disconnect: async () => {
      throw new Error("not used");
    },
  };
  const setup = await testRender(
    () => {
      state = createIntegrationsState(api);
      return (
        <box id="route-shell">
          <IntegrationsPage
            state={state}
            scope="project"
            directory="/project"
            focusRegistry={registry}
          />
        </box>
      );
    },
    { width: 100, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
    const panels = createPanelNavigation(setup.renderer.root, registry, () => true);
    expect(panels.order()).toEqual([
      "browser",
      "command:integration.connect",
      "integration-entries",
    ]);
    registry.applyFocus("browser");
    const actions = panels.next(setup.renderer.currentFocusedRenderable, false)!;
    registry.applyFocus(actions);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("integration-connect");
    expect(
      registry.dispatchMode(setup.renderer.currentFocusedRenderable!, {
        name: "right",
        ctrl: false,
        meta: false,
        shift: false,
        alt: false,
      }),
    ).toBe("consumed");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("integration-disconnect");
    registry.applyFocus(panels.next(setup.renderer.currentFocusedRenderable, false)!);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("integration-entries");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(state!.selected()).toBe("/project/.codex/config.toml");
  } finally {
    setup.renderer.destroy();
  }
});
