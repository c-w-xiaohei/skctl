import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { createCommandRegistry, type ExecutableCommand } from "../src/commands";
import type { CommandRecord } from "../src/types";

const record = (id: string, destination = "Source A"): CommandRecord => ({
  id,
  destination,
  verb: "Update Source",
  keys: ["enter"],
  scope: "page",
  enabled: true,
  danger: false,
});

test("one registry resolves mounted, contextual and global commands with mounted definitions taking priority", () => {
  createRoot((dispose) => {
    try {
      const calls: string[] = [];
      const [context, setContext] = createSignal<readonly ExecutableCommand[]>([
        { record: record("update"), execute: () => calls.push("fallback") },
        { record: { ...record("global"), scope: "shell" }, execute: () => calls.push("global") },
      ]);
      const commands = createCommandRegistry(context);
      const unregister = commands.register(
        record("update", "Source B"),
        "browser",
        "update-control",
        () => calls.push("mounted"),
      );
      expect(commands.records().map((item) => [item.id, item.destination])).toEqual([
        ["update", "Source B"],
        ["global", "Source A"],
      ]);
      expect(commands.execute("update")).toBe(true);
      expect(calls).toEqual(["mounted"]);
      unregister();
      expect(commands.execute("update")).toBe(true);
      setContext([
        { record: record("update", "Source C"), execute: () => calls.push("new context") },
      ]);
      expect(commands.records()[0]?.destination).toBe("Source C");
      expect(commands.execute("global")).toBe(false);
      expect(commands.execute("update")).toBe(true);
      expect(calls).toEqual(["mounted", "fallback", "new context"]);
    } finally {
      dispose();
    }
  });
});

test("stale cleanup cannot unregister a replacement and a stale ID cannot bypass current eligibility", () => {
  createRoot((dispose) => {
    try {
      let calls = 0;
      const commands = createCommandRegistry(() => []);
      const old = commands.register(record("update"), "browser", "old", () => calls++);
      const next = commands.register(
        { ...record("update"), enabled: false, disabledReason: "An update is running" },
        "browser",
        "new",
        () => calls++,
      );
      old();
      expect(commands.mounted().get("update")?.controlId).toBe("new");
      expect(commands.records()[0]?.disabledReason).toBe("An update is running");
      expect(commands.execute("update")).toBe(false);
      next();
      expect(commands.records()).toEqual([]);
      expect(commands.execute("update")).toBe(false);
      expect(calls).toBe(0);
    } finally {
      dispose();
    }
  });
});

test("discovery visibility is declared by the command rather than an App ID exclusion list", () => {
  createRoot((dispose) => {
    try {
      const commands = createCommandRegistry(() => [{ record: record("stop"), execute: () => {} }]);
      commands.register(
        { ...record("local-stop"), palette: false },
        "browser",
        "stop-button",
        () => {},
      );
      commands.register({ ...record("widget"), scope: "widget" }, "browser", "widget", () => {});
      expect([...commands.mounted().keys()]).toEqual(["local-stop", "widget"]);
      expect(commands.records().map((item) => item.id)).toEqual(["stop"]);
      expect(commands.execute("local-stop")).toBe(false);
    } finally {
      dispose();
    }
  });
});
