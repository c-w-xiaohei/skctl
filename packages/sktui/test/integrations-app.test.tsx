import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { MutationRequest, IntegrationTarget } from "@skctl/integrations";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import type { IntegrationsApi } from "../src/integrations/state";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";
import { mkdir, writeFile } from "node:fs/promises";

test.each([
  [100, 24],
  [43, 13],
])(
  "shared-file confirmation remains keyboard reachable at %ix%i after the disconnect control is replaced",
  async (width, height) => {
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
      { width, height },
    );
    try {
      await openMainPage(setup, "agent");
      await focusLive(setup, "agent-view-tab-project");
      await parsedEnter(setup);
      if (width < 100) await enterLive(setup, "integration-hosts");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
      await focusLive(setup, "integration-disconnect");
      await parsedEnter(setup);
      await setup.waitForFrame((frame) => frame.includes("Confirm disconnect"));
      const confirm = setup.renderer.root.findDescendantById("integration-confirm")!;
      expect(confirm.screenX + confirm.width).toBeLessThanOrEqual(width);
      expect(confirm.screenY + confirm.height).toBeLessThanOrEqual(height - 1);
      await mkdir("out/agent-workspace", { recursive: true });
      await writeFile(
        `out/agent-workspace/confirm-${width}x${height}.txt`,
        setup.captureCharFrame(),
      );
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
  },
);

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

test.each(["enter", "tab"])(
  "Agent %s enters the same narrow workspace and Back restores the host",
  async (entry) => {
    const inspected: IntegrationTarget[] = [];
    const integrations: IntegrationsApi = {
      inspect: async (target) => {
        inspected.push(target);
        return {
          target,
          recommended: "default",
          selectionReason: "Instruction file",
          cli: "/bin/skctl",
          revision: "1",
          entries: [
            {
              file: "/project/AGENTS.md",
              mechanism: "default",
              status: "current",
              inherited: false,
              selected: "selected",
            },
          ],
          candidates: [],
          diagnostics: [],
          nextSteps: [],
        };
      },
      connect: async () => {
        throw new Error("Unexpected connect");
      },
      disconnect: async () => {
        throw new Error("Unexpected disconnect");
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
      { width: 43, height: 13 },
    );
    try {
      await openMainPage(setup, "agent");
      await enterLive(setup, "agent-view-tab-project");
      await focusLive(setup, "integration-hosts");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => inspected.at(-1)?.environment.harness === "opencode");
      expect(!!setup.renderer.root.findDescendantById("integration-object-pane")).toBe(false);
      if (entry === "enter") await parsedEnter(setup);
      else {
        setup.mockInput.pressKey("TAB");
        await setup.flush();
      }
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "integration-connect",
      );
      expect(!!setup.renderer.root.findDescendantById("integration-hosts")).toBe(false);
      expect(!!setup.renderer.root.findDescendantById("integration-back")).toBe(false);
      const body = setup.renderer.root.findDescendantById("integration-entries-pane")!;
      expect(body.height).toBeGreaterThanOrEqual(6);
      const more = setup.renderer.root.findDescendantById("integration-more")!;
      expect(more.screenX + more.width).toBeLessThanOrEqual(43);
      await mkdir("out/agent-workspace", { recursive: true });
      await writeFile(`out/agent-workspace/${entry}-43x13.txt`, setup.captureCharFrame());
      for (const width of [100, 99, 132, 43]) {
        setup.resize(width, width === 43 ? 13 : 24);
        await setup.flush();
        expect(!!setup.renderer.root.findDescendantById("integration-hosts")).toBe(width >= 100);
        expect(!!setup.renderer.root.findDescendantById("integration-object-pane")).toBe(true);
        expect(setup.captureCharFrame()).toContain("OpenCode");
      }
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "integration-hosts",
      );
      await parsedEnter(setup);
      expect(setup.captureCharFrame()).toContain("OpenCode");
      await openMainPage(setup, "skills");
      await openMainPage(setup, "agent");
      expect(!!setup.renderer.root.findDescendantById("integration-object-pane")).toBe(true);
      expect(setup.captureCharFrame()).toContain("OpenCode");
      await setup.flush();
      const listeners = () =>
        ["frame", "resize"].map((event) => setup.renderer.listenerCount(event));
      const baseline = listeners();
      for (let cycle = 0; cycle < 4; cycle++) {
        await openMainPage(setup, "skills");
        await openMainPage(setup, "agent");
        await setup.flush();
        expect(listeners()).toEqual(baseline);
      }
    } finally {
      setup.renderer.destroy();
    }
  },
);
