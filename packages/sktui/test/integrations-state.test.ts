import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrap } from "../../integrations/src/default";
import type { MutationRequest } from "@skctl/integrations";
import { createIntegrationsState, type IntegrationsApi } from "../src/integrations/state";

test("confirmed shared-file removal revalidates changed bytes and preserves unrelated instructions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skctl-confirm-disconnect-"));
  const file = join(directory, "AGENTS.md");
  const original = `Team instructions\n\n${bootstrap}`;
  const root = createRoot((dispose) => ({ dispose, state: createIntegrationsState() }));
  try {
    await writeFile(file, original);
    root.state.selectTarget({
      environment: {
        harness: "codex",
        configDirectory: join(directory, "home"),
        executable: join(directory, "missing-codex"),
      },
      scope: { kind: "project", directory },
    });
    await root.state.refresh();
    root.state.select(file);
    await root.state.execute("disconnect");
    expect(root.state.confirmation()?.entry?.file).toBe(file);
    expect(await readFile(file, "utf8")).toBe(original);
    const changed = `${original}\nNew team instruction\n`;
    await writeFile(file, changed);
    await root.state.confirmDisconnect();
    expect(root.state.task()?.result?.outcome).toBe("blocked");
    expect(await readFile(file, "utf8")).toBe(changed);
    await root.state.execute("disconnect");
    expect(root.state.confirmation()?.entry?.file).toBe(file);
    await root.state.confirmDisconnect();
    expect(root.state.task()?.result?.outcome).toBe("applied");
    const remaining = await readFile(file, "utf8");
    expect(remaining).toContain("Team instructions");
    expect(remaining).toContain("New team instruction");
    expect(remaining).not.toContain(bootstrap);
  } finally {
    root.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared-file confirmation keeps the reviewed request and is discarded when selection changes", async () => {
  const changes: MutationRequest[] = [];
  const client: IntegrationsApi = {
    inspect: async (target) => ({
      target,
      recommended: "default",
      selectionReason: "Instruction file",
      cli: "/bin/skctl",
      revision: "reviewed",
      entries: ["/project/AGENTS.md", "/project/AGENTS.override.md"].map((file) => ({
        file,
        mechanism: "default",
        inherited: false,
        status: "current",
        selected: "selected",
      })),
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
  const root = createRoot((dispose) => ({ dispose, state: createIntegrationsState(client) }));
  try {
    root.state.selectTarget({
      environment: { harness: "codex" },
      scope: { kind: "project", directory: "/project" },
    });
    await root.state.refresh();
    await root.state.execute("disconnect");
    expect(root.state.confirmation()?.entry?.file).toBe("/project/AGENTS.md");
    root.state.select("/project/AGENTS.override.md");
    await root.state.confirmDisconnect();
    expect(changes).toHaveLength(1);
    await root.state.execute("disconnect");
    root.state.dismissConfirmation();
    await root.state.confirmDisconnect();
    expect(changes).toHaveLength(2);
    await root.state.execute("disconnect");
    await root.state.confirmDisconnect();
    expect(changes[3]).toEqual({ ...changes[2], acknowledgeFileImpact: true });
    expect(root.state.confirmation()).toBeUndefined();
    await root.state.execute("disconnect");
    await root.state.refresh();
    await root.state.confirmDisconnect();
    expect(changes).toHaveLength(5);
    await root.state.execute("disconnect");
    root.state.selectTarget({
      environment: { harness: "opencode" },
      scope: { kind: "project", directory: "/project" },
    });
    await root.state.confirmDisconnect();
    expect(changes).toHaveLength(6);
  } finally {
    root.dispose();
  }
});

test("disconnect requires a selected local entry and carries its inspected revision", async () => {
  const changes: MutationRequest[] = [];
  const client: IntegrationsApi = {
    inspect: async (target) => ({
      target,
      recommended: "codex-hooks",
      selectionReason: "Host files",
      cli: "/bin/skctl",
      revision: "reviewed",
      entries: [
        {
          file: "/project/.codex/hooks.json",
          mechanism: "codex-hooks",
          inherited: false,
          status: "current",
          selected: "unknown",
        },
        {
          file: "/home/user/.codex/hooks.json",
          mechanism: "codex-hooks",
          inherited: true,
          status: "current",
          selected: "unknown",
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
        mechanism: "codex-hooks",
        outcome: "applied",
        diagnostics: [],
      };
    },
  };
  const root = createRoot((dispose) => ({ dispose, state: createIntegrationsState(client) }));
  try {
    await root.state.execute("disconnect");
    root.state.selectTarget({
      environment: { harness: "codex" },
      scope: { kind: "project", directory: "/project" },
    });
    await root.state.refresh();
    for (const selected of [undefined, "/missing", "/home/user/.codex/hooks.json"]) {
      root.state.select(selected);
      await root.state.execute("disconnect");
    }
    expect(changes).toEqual([]);
    root.state.select("/project/.codex/hooks.json");
    await root.state.execute("disconnect");
    expect(changes).toEqual([
      {
        target: {
          environment: { harness: "codex" },
          scope: { kind: "project", directory: "/project" },
        },
        entry: { file: "/project/.codex/hooks.json", mechanism: "codex-hooks" },
        expected: "reviewed",
        acknowledgeFileImpact: false,
      },
    ]);
  } finally {
    root.dispose();
  }
});
