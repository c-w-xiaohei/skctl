import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
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
            wide={width >= 100}
            browserWidth={38}
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
    if (width < 100) await enterLive(setup, "integration-hosts");
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

test("a running connection keeps its captured host, scope and file after browsing another host", async () => {
  let finish!: (value: Awaited<ReturnType<IntegrationsApi["disconnect"]>>) => void;
  const changes: MutationRequest[] = [];
  const api: IntegrationsApi = {
    inspect: async (target) => ({
      target,
      recommended: "default",
      revision: "reviewed",
      cli: "/bin/skctl",
      selectionReason: "Instruction file",
      entries: [
        {
          file: `/project/${target.environment.harness}.md`,
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
    disconnect: (request) => {
      changes.push(request);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const setup = await testRender(
    () => {
      const state = createIntegrationsState(api);
      return (
        <IntegrationsPage
          state={state}
          wide
          browserWidth={38}
          scope="project"
          directory="/project"
        />
      );
    },
    { width: 120, height: 24 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
    await enterLive(setup, "integration-disconnect");
    await focusLive(setup, "integration-hosts");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(changes).toHaveLength(1);
    expect(setup.captureCharFrame()).toContain("/project/codex.md");
    finish({ action: "disconnect", outcome: "applied", mechanism: "default", diagnostics: [] });
    await setup.waitForFrame((frame) => frame.includes("applied"));
    expect(setup.captureCharFrame()).toContain("/project/codex.md");
    expect(setup.captureCharFrame()).toContain("/project/opencode.md");
    await mkdir("out/agent-workspace", { recursive: true });
    await writeFile("out/agent-workspace/captured-task-120x24.txt", setup.captureCharFrame());
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
            wide
            browserWidth={38}
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

test.each([43, 80, 100, 132])(
  "Agent connections use one workspace with a restorable host at %i columns",
  async (width) => {
    const registry = createFocusRegistry();
    const api: IntegrationsApi = {
      inspect: async (target) => ({
        target,
        revision: "1",
        recommended: null,
        cli: "/bin/skctl",
        selectionReason: "Native entry",
        entries: [],
        candidates: [],
        diagnostics: [],
        nextSteps: [],
      }),
      connect: async () => {
        throw new Error("Unexpected mutation");
      },
      disconnect: async () => {
        throw new Error("Unexpected mutation");
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
              wide={width >= 100}
              browserWidth={42}
              focusRegistry={registry}
            />
          </box>
        );
      },
      { width, height: 24 },
    );
    try {
      await focusLive(setup, "integration-hosts");
      setup.mockInput.pressArrow("down");
      await setup.flush();
      const hosts = setup.renderer.root.findDescendantById("integration-hosts-pane")!;
      if (width >= 100) {
        expect(hosts.width).toBe(42);
        const object = setup.renderer.root.findDescendantById("integration-object-pane")!;
        expect(object.screenY).toBe(hosts.screenY);
        expect(object.screenX).toBe(hosts.screenX + hosts.width + 1);
      } else {
        expect(!!setup.renderer.root.findDescendantById("integration-object-pane")).toBe(false);
      }
      await enterLive(setup, "integration-hosts");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "integration-connect",
      );
      const object = setup.renderer.root.findDescendantById("integration-object-pane")!;
      expect(object.screenX + object.width).toBeLessThanOrEqual(width);
      expect(setup.renderer.root.findDescendantById("integration-actions-pane")!.height).toBe(1);
      expect(setup.captureCharFrame()).toContain("OpenCode");
      await enterLive(setup, "integration-back");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "integration-hosts",
      );
      await enterLive(setup, "integration-hosts");
      expect(setup.captureCharFrame()).toContain("OpenCode");
    } finally {
      setup.renderer.destroy();
    }
  },
);
