import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSource, withPreparedSkills } from "../../src/source/service";
import { withRepository } from "../../src/source/service/remote/cache";
import { GitObjects } from "../../src/source/service/remote/objects";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createExecutableFixture } from "../executable-fixture";
import { repositoryFixture } from "./repository-fixture";

const origin = "https://github.com/acme/skills";
const binding = {
  id: "remote",
  kind: "git" as const,
  origin,
  root: "",
  ref: "main",
  selectors: [],
  provenance: { level: "project" as const },
};
const identify = `identify() { while [ "$#" -gt 0 ]; do
  case "$1" in -c) shift 2;; --git-dir=*) shift;; *) command="$1"; option="\${2:-}"; break;; esac
done; }
identify "$@"`;
let cache: string, bin: string;
let saved: Record<string, string | undefined>;
let roots: string[];
beforeEach(async () => {
  saved = { PATH: process.env.PATH, SKCTL_SOURCE_CACHE_DIR: process.env.SKCTL_SOURCE_CACHE_DIR };
  cache = await mkdtemp(join(tmpdir(), "skctl-git-cache-"));
  const executable = await createExecutableFixture();
  bin = join(executable, "bin");
  await mkdir(bin);
  roots = [cache, executable];
  process.env.SKCTL_SOURCE_CACHE_DIR = cache;
});
afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function fixture(files?: Readonly<Record<string, string>>) {
  const value = await repositoryFixture(files);
  roots.push(value.root);
  return value;
}
async function shim(script: string) {
  await writeFile(join(bin, "git"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  process.env.PATH = `${bin}:${saved.PATH}`;
}

test("Generic Git prepares an exact pinned Skill with literal paths and executable modes", async () => {
  const value = await fixture({
    "skill space/SKILL.md": "---\nname: remote\ndescription: Remote\n---\n",
    "skill space/run.sh": "#!/bin/sh\n",
  });
  await chmod(join(value.work, "skill space", "run.sh"), 0o755);
  await value.git("add", ".");
  await value.git("commit", "-m", "executable");
  const revision = await value.git("rev-parse", "HEAD");
  await value.git("push", value.bare, "HEAD:main");
  let prepared: string | undefined;
  await withPreparedSkills(
    { binding: { ...binding, root: "skill space" }, transport: () => value.bare },
    [""],
    revision,
    async ([skill]) => {
      prepared = skill!.directory;
      expect(skill).toMatchObject({ kind: "remote", path: "", revision, name: "remote" });
      expect((await lstat(join(prepared!, "run.sh"))).mode & 0o111).toBeTruthy();
      expect(await readFile(join(prepared!, "run.sh"), "utf8")).toBe("#!/bin/sh\n");
    },
  );
  await expect(lstat(prepared!)).rejects.toHaveProperty("code", "ENOENT");
});

test("Generic Git never broadens a rejected exact fetch to advertised refs", async () => {
  const value = await fixture(),
    log = join(cache, "commands");
  await shim(
    `printf '%s\\n' "$*" >> '${log}'\n${identify}\nif [ "$command" = fetch ]; then exit 1; fi\nexec /usr/bin/git "$@"`,
  );
  await expect(
    withRepository({ ...binding, transport: () => value.bare }, async (reader) => {
      await reader.revision({ commit: value.commit });
    }),
  ).rejects.toHaveProperty("code", "PROVIDER_UNAVAILABLE");
  const commands = await readFile(log, "utf8");
  expect(commands.match(/ fetch /gu)).toHaveLength(1);
  expect(commands).not.toMatch(/refs\/heads\/\*|ls-remote/);
});

test("Generic Git acquires metadata without blobs, including for a GitHub-shaped origin", async () => {
  const value = await fixture(),
    log = join(cache, "commands");
  await shim(`printf '%s\\n' "$*" >> '${log}'\nexec /usr/bin/git "$@"`);
  await withRepository(
    { ...binding, transport: () => value.bare, githubApiBaseUrl: "http://127.0.0.1:1" },
    async (reader) => {
      const revision = await reader.revision({ commit: value.commit });
      expect((await revision!.readTree(revision!.version.tree)).map((entry) => entry.path)).toEqual(
        ["SKILL.md"],
      );
    },
  );
  const commands = await readFile(log, "utf8");
  expect(commands).toContain("fetch --no-tags --depth=1 --filter=blob:none");
  const key = new Bun.CryptoHasher("sha256").update(origin).digest("hex");
  const inventory = await value.git(
    `--git-dir=${join(cache, "origins", key, "objects.git")}`,
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objecttype)",
  );
  expect(inventory).not.toContain("blob");
  expect(
    (
      await discoverSource({
        binding,
        transport: () => value.bare,
        githubApiBaseUrl: "http://127.0.0.1:1",
      })
    ).candidates,
  ).toHaveLength(1);
});

test("Generic Git batches candidate markers without unselected resources and reuses them during preparation", async () => {
  const value = await fixture({
    "chosen/SKILL.md": "---\nname: chosen\ndescription: Chosen\n---\n",
    "chosen/helper.txt": "chosen helper\n",
    "other/SKILL.md": "---\nname: other\ndescription: Other\n---\n",
    "other/unselected.txt": "must not be fetched\n",
  });
  const log = join(cache, "commands"),
    wants = join(cache, "wants");
  await shim(`printf '%s\\n' "$*" >> '${log}'\n${identify}
if [ "$command" = fetch ] && printf '%s\\n' "$@" | grep -qx -- '--stdin'; then
  input=$(cat); printf '%s\\n' "$input" >> '${wants}'; printf '%s\\n' "$input" | /usr/bin/git "$@"; exit $?
fi
exec /usr/bin/git "$@"`);
  const context = { binding, transport: () => value.bare };
  expect((await discoverSource(context)).candidates.map((item) => item.name)).toEqual([
    "chosen",
    "other",
  ]);
  expect(
    (await readFile(log, "utf8"))
      .split("\n")
      .filter((line) => line.includes(" fetch ") && line.includes("--stdin")),
  ).toHaveLength(1);
  const chosen = await value.git("rev-parse", "HEAD:chosen/SKILL.md");
  const other = await value.git("rev-parse", "HEAD:other/unselected.txt");
  expect(await readFile(wants, "utf8")).toContain(chosen);
  expect(await readFile(wants, "utf8")).not.toContain(other);
  await withPreparedSkills(context, ["chosen"], value.commit, async ([skill]) => {
    expect(await readFile(join(skill!.directory, "helper.txt"), "utf8")).toBe("chosen helper\n");
  });
  const requests = (await readFile(wants, "utf8")).trim().split("\n");
  expect(requests.filter((id) => id === chosen)).toHaveLength(1);
  expect(requests).not.toContain(other);
});

test("Generic Git rejects a server that ignores blob filtering", async () => {
  const value = await fixture();
  await value.git("--git-dir", value.bare, "config", "uploadpack.allowFilter", "false");
  await expect(discoverSource({ binding, transport: () => value.bare })).rejects.toHaveProperty(
    "code",
    "PROVIDER_INTEGRITY_FAILED",
  );
});

test("concurrent Generic Git readers serialize cache access and complete before releasing their lifetimes", async () => {
  const value = await fixture({ "one.txt": "one", "two.txt": "two" });
  const one = await value.git("rev-parse", "HEAD:one.txt"),
    two = await value.git("rev-parse", "HEAD:two.txt");
  const result = await Promise.all(
    [one, two].map((id) =>
      withRepository({ ...binding, transport: () => value.bare }, async (reader) => {
        const version = (await reader.revision({ commit: value.commit }))!;
        return Buffer.from((await version.blobs([id])).get(id)!).toString();
      }),
    ),
  );
  expect(result).toEqual(["one", "two"]);
  expect((await readdir(join(cache, "locks"))).filter((name) => !name.endsWith(".owner"))).toEqual(
    [],
  );
});

test.each([
  ["transport", "token=transport-secret", "PROVIDER_UNAVAILABLE"],
  ["authentication", "authentication failed: token=auth-secret", "PROVIDER_AUTH_FAILED"],
])("Generic Git sanitizes %s failures", async (_name, stderr, code) => {
  const value = await fixture();
  await shim(
    `${identify}\nif [ "$command" = fetch ]; then printf '%s' '${stderr}' >&2; exit 1; fi\nexec /usr/bin/git "$@"`,
  );
  const error = await withRepository({ ...binding, transport: () => value.bare }, async (reader) =>
    reader.revision({ commit: value.commit }),
  ).catch((error: unknown) => error);
  expect(error).toMatchObject({ code });
  expect(String(error)).not.toContain("secret");
});

test("Generic Git sanitizes a failed local object read after acquisition", async () => {
  const value = await fixture({ "one.txt": "one" });
  const id = await value.git("rev-parse", "HEAD:one.txt");
  await withRepository({ ...binding, transport: () => value.bare }, async (reader) => {
    const version = (await reader.revision({ commit: value.commit }))!;
    await version.blobs([id]);
    const key = new Bun.CryptoHasher("sha256").update(origin).digest("hex");
    await writeFile(
      join(cache, "origins", key, "objects.git", "objects", "pack", "invalid.idx"),
      "token=private-secret",
    );
    const error = await version.blobs([id]).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "PROVIDER_INTEGRITY_FAILED" });
    expect(String(error)).not.toContain("private-secret");
  });
});

test("Generic Git can read a symlink blob but Skill preparation rejects it before fetching link bytes", async () => {
  const value = await fixture({
    "SKILL.md": "---\nname: linked\ndescription: Linked\n---\n",
    "target.txt": "target",
  });
  await symlink("target.txt", join(value.work, "link"));
  await value.git("add", ".");
  await value.git("commit", "-m", "link");
  const revision = await value.git("rev-parse", "HEAD"),
    id = await value.git("rev-parse", "HEAD:link");
  await value.git("push", value.bare, "HEAD:main");
  const context = { binding, transport: () => value.bare };
  await expect(withPreparedSkills(context, [""], revision, async () => {})).rejects.toHaveProperty(
    "code",
    "PROVIDER_INTEGRITY_FAILED",
  );
  await withRepository({ ...binding, transport: () => value.bare }, async (reader) => {
    const version = await reader.revision({ commit: revision });
    expect(
      (await version!.readTree(version!.version.tree)).find((entry) => entry.path === "link")?.mode,
    ).toBe("120000");
    expect(Buffer.from((await version!.blobs([id])).get(id)!).toString()).toBe("target.txt");
  });
});

test.each([
  ["wrong size", Buffer.from("blob 4\0one")],
  ["extra header field", Buffer.from("blob 3 extra\0one")],
  ["non-decimal size", Buffer.from("blob 0x3\0one")],
  ["trailing bytes", Buffer.from("blob 3\0onetr ailing")],
])("Generic Git rejects malformed object %s", async (_name, response) => {
  const objects = new GitObjects(join(cache, "local.git"));
  await objects.initialize();
  const bytes = Buffer.from("one"),
    id = createHash("sha1").update("blob 3\0").update(bytes).digest("hex");
  await objects.writeBlob(bytes, id);
  await writeFile(
    join(objects.directory, "objects", id.slice(0, 2), id.slice(2)),
    deflateSync(response),
  );
  await expect(objects.blobs([id])).rejects.toHaveProperty("code", "PROVIDER_INTEGRITY_FAILED");
});

test("Generic Git leaves an empty object batch entirely idle", async () => {
  const objects = new GitObjects(join(cache, "local.git")),
    log = join(cache, "commands");
  await objects.initialize();
  await shim(`printf '%s\\n' "$*" >> '${log}'\nexec /usr/bin/git "$@"`);
  expect(await objects.blobs([])).toEqual(new Map());
  expect(await Bun.file(log).exists()).toBe(false);
});

test("Generic Git never substitutes a missing pinned commit", async () => {
  const value = await fixture();
  await expect(
    withPreparedSkills(
      { binding, transport: () => value.bare },
      [""],
      "a".repeat(40),
      async () => {},
    ),
  ).rejects.toHaveProperty("code", "PINNED_COMMIT_UNAVAILABLE");
});

test("Generic Git aborts, escalates and drains a blocked child", async () => {
  const ready = join(cache, "ready"),
    pid = join(cache, "pid"),
    controller = new AbortController();
  await shim(`${identify}
if [ "$command" = init ]; then
  : > '${ready}'; printf '%s' "$$" > '${pid}'; trap '' TERM
  i=0; while [ "$i" -lt 8192 ]; do printf 'blocked stderr %s\\n' "$i" >&2; i=$((i + 1)); done
  while :; do sleep 1; done
fi
exec /usr/bin/git "$@"`);
  const pending = withRepository({ ...binding, signal: controller.signal }, async (reader) =>
    reader.revision({ commit: "a".repeat(40) }),
  );
  try {
    for (let attempt = 0; attempt < 100 && !(await Bun.file(ready).exists()); attempt++)
      await Bun.sleep(10);
    expect(await Bun.file(ready).exists()).toBe(true);
    const started = performance.now();
    controller.abort();
    await expect(pending).rejects.toHaveProperty("code", "CANCELLED");
    expect(performance.now() - started).toBeLessThan(1500);
    const blockedPid = Number(await Bun.file(pid).text());
    expect(() => process.kill(blockedPid, 0)).toThrow();
  } finally {
    controller.abort();
    await pending.catch(() => {});
  }
});

test("Generic Git keeps nested paths Source-relative and discovery stops beneath valid or malformed roots", async () => {
  const value = await fixture({
    "a/SKILL.md": "---\nname: a\ndescription: A\n---\n",
    "a/child/SKILL.md": "---\nname: hidden\ndescription: Hidden\n---\n",
    "bad/SKILL.md": "bad",
    "bad/child/SKILL.md": "---\nname: hidden2\ndescription: Hidden\n---\n",
    "z/SKILL.md": "---\nname: z\ndescription: Z\n---\n",
    "z/helper.sh": "#!/bin/sh\n",
  });
  const context = { binding, transport: () => value.bare };
  const discovery = await discoverSource(context);
  expect(discovery.candidates.map((item) => item.path)).toEqual(["a", "z"]);
  expect(discovery.diagnostics).toHaveLength(1);
  await withPreparedSkills(context, ["z"], value.commit, async ([skill]) => {
    expect(skill!.path).toBe("z");
    expect((await readdir(skill!.directory)).sort()).toEqual(["SKILL.md", "helper.sh"]);
  });
  await writeFile(join(value.work, "SKILL.md"), "---\nname: root\ndescription: Root\n---\n");
  await value.git("add", ".");
  await value.git("commit", "-m", "root");
  const commit = await value.git("rev-parse", "HEAD");
  await value.git("push", value.bare, "HEAD:main");
  expect(
    (await discoverSource({ ...context, binding: { ...binding, ref: commit } })).candidates.map(
      (item) => item.path,
    ),
  ).toEqual([""]);
});
