import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContent } from "../../src/core/content";
test("Agent content has no source-provider dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-provider-runtime-"));
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    await writeFile(join(root, "skill-cli.jsonc"), '{ "agents": { "opencode": "managed" } }\n');
    await expect(
      createContent({ cwd: root }).load({ selector: "missing:skill" }),
    ).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
