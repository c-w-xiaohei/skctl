import { expect, test } from "bun:test";

import { runMain } from "../src/main";

test("human profile rename remains an unknown command", async () => {
  let stdout = "";
  let stderr = "";
  const code = await runMain(["profile", "rename", "old", "new"], {
    cwd: process.cwd(),
    stdinIsTTY: false,
    stdoutIsTTY: false,
    stdout: { write: (chunk) => (stdout += String(chunk)) },
    stderr: { write: (chunk) => (stderr += String(chunk)) },
  });
  expect(code).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toContain("unknown command");
});
