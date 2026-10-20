import * as api from "../../src/index";
import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
test.serial(
  "content.run normalizes runtime signal numbers without changing named strings or null",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "skctl-runtime-signal-"));
    const state = join(root, "state");
    const skill = join(root, "skills", "review");
    const previous = process.env.SKCTL_STATE_DIR;
    try {
      await mkdir(skill, { recursive: true });
      await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
      await writeFile(
        join(root, "skctl.jsonc"),
        JSON.stringify({
          sources: { local: { kind: "local", path: "./skills", root: "" } },
          collections: { c: { members: { review: { source: "local", path: "review" } } } },
          use: ["c"],
          agents: { opencode: "managed" },
        }),
      );
      process.env.SKCTL_STATE_DIR = state;
      const core = { cwd: root, userConfigPath: join(root, "global.jsonc") };
      await api.installSkills(core, { source: "local", paths: ["review"] });
      const cases = [
        { reported: constants.signals.SIGTERM, expected: "SIGTERM", cancelled: false },
        { reported: constants.signals.SIGKILL, expected: "SIGKILL", cancelled: false },
        { reported: 987654, expected: "987654", cancelled: false },
        { reported: "SIGUSR1", expected: "SIGUSR1", cancelled: false },
        { reported: null, expected: null, cancelled: false },
        { reported: null, expected: "SIGTERM", cancelled: true },
      ];
      for (const { reported, expected, cancelled } of cases) {
        // Real completed child retains all Bun process fields/methods. Only the
        // runtime return representation is controlled, with no production seam.
        const child = Bun.spawn({
          cmd: [process.execPath, "--eval", "void 0"],
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        await child.exited;
        Object.defineProperty(child, "signalCode", { configurable: true, get: () => reported });
        const controller = new AbortController();
        const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
          if (cancelled) controller.abort();
          return child;
        });
        try {
          const result = await api.runSkill(
            core,
            { selector: "c:review", argv: [process.execPath, "--eval", "void 0"] },
            { signal: controller.signal },
          );
          expect(result).toMatchObject({ selector: "c:review", signal: expected, cancelled });
          if (!cancelled) expect(result.exitCode).toBe(0);
          expect(spawn).toHaveBeenCalledTimes(1);
          expect(await readdir(join(state, "runs"))).toEqual([]);
        } finally {
          spawn.mockRestore();
        }
      }
    } finally {
      if (previous === undefined) delete process.env.SKCTL_STATE_DIR;
      else process.env.SKCTL_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);
test.skipIf(process.platform !== "linux")(
  "content.run preserves a real unnamed Linux signal number as text, not exit status",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "skctl-runtime-real-signal-"));
    const state = join(root, "state");
    const skill = join(root, "skills", "review");
    const previous = process.env.SKCTL_STATE_DIR;
    try {
      await mkdir(skill, { recursive: true });
      await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
      await writeFile(
        join(root, "skctl.jsonc"),
        JSON.stringify({
          sources: { local: { kind: "local", path: "./skills", root: "" } },
          collections: { c: { members: { review: { source: "local", path: "review" } } } },
          use: ["c"],
          agents: { opencode: "managed" },
        }),
      );
      process.env.SKCTL_STATE_DIR = state;
      const core = { cwd: root, userConfigPath: join(root, "global.jsonc") };
      await api.installSkills(core, { source: "local", paths: ["review"] });
      // Linux x64 signal 35 is a real-time signal, not in Node's named constants.
      expect(Object.values(constants.signals)).not.toContain(35);
      const control = Bun.spawn(["/bin/sh", "-c", "kill -35 $$"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await control.exited).toBe(163);
      expect<unknown>(control.signalCode).toBe(35);
      const result = await api.runSkill(core, {
        selector: "c:review",
        argv: ["/bin/sh", "-c", "kill -35 $$"],
      });
      expect(result).toEqual({
        selector: "c:review",
        exitCode: 163,
        signal: "35",
        cancelled: false,
      });
      expect(await readdir(join(state, "runs"))).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.SKCTL_STATE_DIR;
      else process.env.SKCTL_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);
