import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkill } from "../../src/content/operations";
import { setAcquisitionTrapForTest } from "../../src/source/snapshot";
test("Agent content has no source-provider dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-provider-runtime-"));
  const global = join(root, "global.jsonc");
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    setAcquisitionTrapForTest(() => {
      throw new Error("provider access");
    });
    await writeFile(global, "{}\n");
    await writeFile(join(root, "skill-cli.jsonc"), '{ "agents": { "opencode": "managed" } }\n');
    await expect(
      loadSkill({ cwd: root, userConfigPath: global }, { selector: "missing:skill" }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  } finally {
    setAcquisitionTrapForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
