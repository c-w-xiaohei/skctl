import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("REG-001..006/010/011/013/014 remove the debug parser and old shell", async () => {
  const app = await readFile(new URL("../../src/tui/app.tsx", import.meta.url), "utf8");
  expect(app).not.toContain("createTuiShell");
  expect(app).not.toContain("paletteHelp");
  expect(app).not.toContain("Route:");
  expect(app).not.toContain("process.exit");
  expect(app).toContain("createCliRenderer");
});
