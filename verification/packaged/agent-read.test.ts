import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { bindingDigest } from "../../packages/skill-core/src/source/identity";

test("packaged Agent reads legacy snapshots offline without migration writes or directory hashing", async () => {
  const root = await mkdtemp(join(tmpdir(), "packaged-agent-read-"));
  const state = join(root, "state"),
    digest = "a".repeat(64);
  const snapshot = join(state, "snapshots", digest, "root");
  const origin = "https://example.test/skills";
  try {
    await mkdir(join(snapshot, "references"), { recursive: true });
    await writeFile(join(snapshot, "SKILL.md"), "---\nname: guide\ndescription: Guide\n---\n");
    await writeFile(join(snapshot, "references/one.md"), "exact installed resource\n");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: { remote: { kind: "git", origin, ref: "main", root: "" } },
        collections: { c: { members: { guide: { source: "remote", path: "guide" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    const bytes = JSON.stringify({
      version: 3,
      generation: 9,
      installed: [
        {
          source: "remote",
          path: "guide",
          name: "guide",
          description: "Guide",
          kind: "remote",
          digest,
          bindingDigest: bindingDigest({ kind: "git", origin, ref: "main", root: "" }),
          adoptedRevision: "b".repeat(40),
          identityEvidence: {
            status: "known",
            canonicalOrigin: origin,
            originRelativeSkillRoot: "guide",
          },
        },
      ],
      configs: {},
    });
    await writeFile(join(state, "state.json"), bytes);
    for (const path of ["references/one.md", "SKILL.md"]) {
      const child = Bun.spawn(
        [resolve("dist/skctl-linux-x64"), "--project", root, "agent", "read", "c:guide", path],
        {
          env: { ...process.env, SKCTL_STATE_DIR: state, XDG_CONFIG_HOME: join(root, "config") },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
      expect(stdout).toBe(await readFile(join(snapshot, path), "utf8"));
      expect(await readFile(join(state, "state.json"), "utf8")).toBe(bytes);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
