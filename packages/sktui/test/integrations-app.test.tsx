import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { MutationRequest, IntegrationTarget } from "@skctl/integrations";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import type { IntegrationsApi } from "../src/integrations/state";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { focusLive, parsedEnter } from "./reader-test-controls";

test("shared-file confirmation remains keyboard reachable after the disconnect control is replaced", async () => {
  const requests: MutationRequest[] = [];
  const integrations: IntegrationsApi = {
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
      requests.push(request);
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
    () => (
      <App
        core={directSourceCore(readerProjection())}
        integrations={integrations}
        environment={{ cwd: "/project" }}
        exit={() => {}}
      />
    ),
    { width: 100, height: 24 },
  );
  try {
    await openMainPage(setup, "agent");
    await focusLive(setup, "agent-view-tab-project");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
    await focusLive(setup, "integration-disconnect");
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Confirm disconnect"));
    // Traverse the actual panel order; confirmation must work without programmatic focus.
    for (
      let i = 0;
      i < 10 && setup.renderer.currentFocusedRenderable?.id !== "integration-keep";
      i++
    ) {
      setup.mockInput.pressKey("TAB");
      await setup.flush();
    }
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("integration-keep");
    setup.mockInput.pressArrow("right");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("integration-confirm");
    expect(requests).toHaveLength(1);
    await parsedEnter(setup);
    await setup.waitFor(() => requests.length === 2);
    expect(requests[1]).toEqual({ ...requests[0], acknowledgeFileImpact: true });
  } finally {
    setup.renderer.destroy();
  }
});

for (const brokenWorkspace of [false, true]) {
  test(`full App manages host entries with keyboard when Core ${brokenWorkspace ? "fails" : "loads"}`, async () => {
    const inspected: IntegrationTarget[] = [];
    const connected: MutationRequest[] = [];
    const disconnected: MutationRequest[] = [];
    let reads = 0;
    let entries = ["/project/.codex/hooks.json", "/project/.codex/config.toml"];
    const integrations: IntegrationsApi = {
      inspect: async (target) => {
        inspected.push(target);
        return {
          target,
          recommended: "codex-hooks",
          selectionReason: "fixture",
          entries: entries.map((file) => ({
            mechanism: "codex-hooks",
            file,
            status: "current",
            inherited: false,
            selected: "unknown",
          })),
          candidates: [],
          cli: "/bin/skctl",
          revision: "revision-1",
          diagnostics: [],
          nextSteps: [],
        };
      },
      connect: async (request) => {
        connected.push(request);
        return {
          action: "connect",
          mechanism: "codex-hooks",
          outcome: "unchanged",
          diagnostics: [],
        };
      },
      disconnect: async (request) => {
        disconnected.push(request);
        entries = entries.filter((file) => file !== request.entry?.file);
        return {
          action: "disconnect",
          mechanism: "codex-hooks",
          outcome: "applied",
          diagnostics: [],
        };
      },
    };
    const core = directSourceCore(readerProjection());
    const setup = await testRender(
      () => (
        <App
          core={{
            ...core,
            getWorkspace: async (...args) => {
              reads++;
              if (brokenWorkspace) throw new Error("Fixture workspace is unavailable");
              return core.getWorkspace(...args);
            },
          }}
          environment={{ cwd: "/project" }}
          integrations={integrations}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    const key = async (name: string, shift = false) => {
      setup.mockInput.pressKey(name, { shift });
      await setup.renderOnce();
    };
    try {
      await setup.waitFor(() => reads > 0);
      await openMainPage(setup, "agent");
      await focusLive(setup, "agent-view-tab-project");
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-hosts"));
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
      expect(inspected.at(-1)?.scope).toEqual({ kind: "project", directory: "/project" });
      const initialReads = reads;
      await focusLive(setup, "integration-hosts");
      await key("TAB");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("integration-connect");
      await parsedEnter(setup);
      await setup.waitFor(() => connected.length === 1 && inspected.length >= 2);
      expect(connected[0]?.expected).toBe("revision-1");
      await key("TAB");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("integration-entries");
      await key("ARROW_DOWN");
      await key("TAB", true);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("integration-connect");
      await key("ARROW_RIGHT");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("integration-disconnect");
      await parsedEnter(setup);
      await setup.waitFor(() => disconnected.length === 1);
      expect(disconnected[0]?.entry?.file).toBe("/project/.codex/config.toml");
      expect(reads).toBe(initialReads);
      await focusLive(setup, "integration-hosts");
      await key("ARROW_DOWN");
      await setup.waitFor(() => inspected.at(-1)?.environment.harness === "opencode");
    } finally {
      setup.renderer.destroy();
    }
  });
}
