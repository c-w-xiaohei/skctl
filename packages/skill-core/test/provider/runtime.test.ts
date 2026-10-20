import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkill } from "../../src/content/operations";
test("Agent content has no source-provider dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-provider-runtime-"));
  const global = join(root, "global.jsonc");
  process.env.SKCTL_STATE_DIR = join(root, "state");
  try {
    await writeFile(global, "{}\n");
    await writeFile(join(root, "skctl.jsonc"), '{ "agents": { "opencode": "managed" } }\n');
    await expect(
      loadSkill(
        {
          cwd: root,
          userConfigPath: global,
          sourceTransport: () => {
            throw new Error("provider access");
          },
        },
        { selector: "missing:skill" },
      ),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
