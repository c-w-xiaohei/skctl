import * as api from "../../src/index";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as filesystem from "node:fs/promises";
import * as gitObjects from "isomorphic-git";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as service from "../../src/source/service";
import * as directory from "../../src/content/directory";
import type { PrivateState } from "../../src/storage/schema";
import { GitObjects } from "../../src/source/service/remote/objects";
import { createExecutableFixture } from "../executable-fixture";
afterEach(() => mock.restore());
const sourceRoot = "library/skills";
const reviewPath = "group/review";
const origin = "https://example.test/tree-scope.git";
async function localReviewFixture() {
  const root = await mkdtemp(join(tmpdir(), "w3-local-review-"));
  const saved = process.env.SKCTL_STATE_DIR;
  const localOrigin = join(root, "origin");
  const boundary = join(localOrigin, "library", "skills");
  const stateFile = join(root, "state", "state.json");
  async function cleanup() {
    if (saved === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = saved;
    await rm(root, { recursive: true, force: true });
  }
  try {
    process.env.SKCTL_STATE_DIR = join(root, "state");
    const core = { cwd: root, userConfigPath: join(root, "user.jsonc") };
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    for (const path of ["one", "two"]) {
      await mkdir(join(boundary, path), { recursive: true });
      await writeFile(
        join(boundary, path, "SKILL.md"),
        `---\nname: ${path}\ndescription: Original ${path}\n---\n`,
      );
      await writeFile(join(boundary, path, "resource.txt"), `Original ${path} resource\n`);
    }
    await api.registerSource(core, {
      level: "project",
      id: "local-review",
      binding: { kind: "local", path: "./origin", root: "library/skills" },
    });
    await api.installSkills(core, { source: "local-review", paths: ["one"] });
    return { root, localOrigin, boundary, stateFile, core, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
async function fixture(ref = "main") {
  const root = await mkdtemp(join(tmpdir(), "skctl-update-tree-scope-"));
  const saved = new Map(
    [
      "PATH",
      "SKCTL_STATE_DIR",
      "SKCTL_SOURCE_CACHE_DIR",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
    ].map((key) => [key, process.env[key]] as const),
  );
  const realGit = Bun.which("git");
  if (!realGit) {
    await rm(root, { recursive: true, force: true });
    throw new Error("Git is required for the isolated repository fixture");
  }
  let bin: string | undefined;
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const stateFile = join(root, "state", "state.json");
  const trace = join(root, "git-trace");
  const fetchWants = join(root, "fetch-wants");
  async function cleanup() {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (bin) await rm(bin, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
  async function git(...args: string[]) {
    const child = Bun.spawn({
      cmd: [realGit!, ...args],
      cwd: work,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (status) throw new Error(`Git fixture ${args[0]} failed: ${stderr}`);
    return stdout.trim();
  }
  async function put(path: string, content: string) {
    const target = join(work, sourceRoot, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  async function commit(message: string) {
    await git("add", "-A");
    await git("commit", "-m", message);
    await git("push", "origin", "HEAD:main");
    // These scenarios review a new ref observation. The 30-second reuse window
    // itself is covered by source-cache, not bypassed in production.
    const path = join(
      root,
      "cache",
      "origins",
      new Bun.CryptoHasher("sha256").update(origin).digest("hex"),
      "cache.json",
    );
    const bytes = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (bytes) {
      const index = JSON.parse(bytes);
      for (const ref of Object.values(index.refs) as { observedAt: number }[])
        ref.observedAt -= 31_000;
      await writeFile(path, JSON.stringify(index));
    }
    return git("rev-parse", "HEAD");
  }
  async function state(): Promise<PrivateState> {
    return JSON.parse(await readFile(stateFile, "utf8"));
  }
  try {
    process.env.SKCTL_STATE_DIR = join(root, "state");
    process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
    process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    await writeFile(process.env.GIT_CONFIG_GLOBAL, "");
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    await put(`${reviewPath}/SKILL.md`, "---\nname: review\ndescription: First\n---\n");
    await put(`${reviewPath}/scripts/run.sh`, "#!/bin/sh\necho first\n");
    await put("other/SKILL.md", "---\nname: other\ndescription: Other\n---\n");
    await put("other/resource.txt", "unselected resource\n");
    await git("init", "-b", "main");
    await git("config", "user.email", "test@skctl.invalid");
    await git("config", "user.name", "Skill CLI");
    await git("config", "core.filemode", "true");
    await git("init", "--bare", bare);
    await git(`--git-dir=${bare}`, "config", "uploadpack.allowFilter", "true");
    await git(`--git-dir=${bare}`, "config", "uploadpack.allowReachableSHA1InWant", "true");
    await git("remote", "add", "origin", bare);
    const first = await commit("initial nested Roots");
    // A transparent executable shim records exact blob requests without changing
    // provider replies. Its executable lives on the project mount, not /tmp/noexec.
    bin = await createExecutableFixture();
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
printf '%s\\n' "$*" >> ${quote(trace)}
capture=no
for arg in "$@"; do
  case "$arg" in --stdin) capture=yes ;; esac
done
if [ "$capture" = yes ]; then
  input=$(mktemp ${quote(join(root, "stdin.XXXXXX"))}) || exit 1
  cat > "$input"
   case "$*" in *fetch*--stdin*) cat "$input" >> ${quote(fetchWants)} ;; esac
  ${quote(realGit)} "$@" < "$input"
  status=$?
  rm -f "$input"
  exit "$status"
fi
exec ${quote(realGit)} "$@"
`,
    );
    await chmod(join(bin, "git"), 0o755);
    process.env.PATH = `${bin}:${saved.get("PATH") ?? ""}`;
    const core = {
      cwd: root,
      userConfigPath: join(root, "user.jsonc"),
      sourceTransport: (url: string) => (url === origin ? pathToFileURL(bare).href : undefined),
    };
    await api.registerSource(core, {
      level: "project",
      id: "remote",
      binding: { kind: "git", origin, root: sourceRoot, ref },
    });
    async function install(paths = [reviewPath]) {
      await api.installSkills(core, { source: "remote", paths, exactRevision: first });
    }
    async function clearTrace() {
      await writeFile(trace, "");
      await writeFile(fetchWants, "");
    }
    return {
      root,
      work,
      bare,
      core,
      first,
      stateFile,
      trace,
      wants: fetchWants,
      git,
      put,
      commit,
      state,
      install,
      clearTrace,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
for (const legacy of [false, true]) {
  test(`Remote check is metadata-only and update batches selected content (${legacy ? "v2" : "v3"})`, async () => {
    const value = await fixture();
    try {
      const paths = Array.from({ length: 120 }, (_, index) => `batch/skill-${index}`);
      for (const [index, path] of paths.entries()) {
        await value.put(
          `${path}/SKILL.md`,
          `---\nname: batch-${index}\ndescription: Original ${index}\n---\n`,
        );
        await value.put(
          `${path}/resource.txt`,
          index < 2 ? "Shared selected resource\n" : `Original resource ${index}\n`,
        );
      }
      const installedRevision = await value.commit("batch installed Roots");
      await api.installSkills(value.core, {
        source: "remote",
        paths,
        exactRevision: installedRevision,
      });
      if (legacy) {
        const state = await value.state();
        await writeFile(
          value.stateFile,
          JSON.stringify({
            ...state,
            version: 2,
            installed: state.installed.map((item) => {
              if (item.kind !== "remote") return item;
              const { treeIdentity: _treeIdentity, ...legacy } = item;
              return legacy;
            }),
          }),
        );
      }
      const changedPaths = paths.slice(0, 6);
      for (const [index, path] of changedPaths.entries())
        await value.put(
          `${path}/SKILL.md`,
          `---\nname: batch-${index}\ndescription: Changed ${index}\n---\n`,
        );
      await value.put(
        "batch/uninstalled/SKILL.md",
        "---\nname: uninstalled\ndescription: Never fetched\n---\n",
      );
      const targetRevision = await value.commit("changed installed metadata plus uninstalled Root");
      const selectedPaths = changedPaths.slice(0, 2);
      const expectedSpecs = selectedPaths.flatMap((path) => [
        `${targetRevision}:${sourceRoot}/${path}/SKILL.md`,
        `${targetRevision}:${sourceRoot}/${path}/resource.txt`,
      ]);
      const expected = (await value.git("rev-parse", ...expectedSpecs)).split("\n");
      const unselectedPaths = paths.filter((path) => !selectedPaths.includes(path));
      const excludedSpecs = [
        `${targetRevision}:${sourceRoot}/batch/uninstalled/SKILL.md`,
        ...unselectedPaths.flatMap((path) => [
          `${targetRevision}:${sourceRoot}/${path}/SKILL.md`,
          `${targetRevision}:${sourceRoot}/${path}/resource.txt`,
        ]),
      ];
      const excluded = (await value.git("rev-parse", ...excludedSpecs)).split("\n");
      const before = await readFile(value.stateFile);
      await value.clearTrace();
      const observation = (await api.checkUpdate(value.core, { source: "remote" })).value;
      expect(observation.exactRevision).toBe(targetRevision);
      expect(observation.added).toEqual([]);
      expect(observation.changed.map((item) => item.path).sort()).toEqual([...changedPaths].sort());
      expect(observation.changed.map((item) => item.description).sort()).toEqual(
        changedPaths.map((_, index) => `Original ${index}`).sort(),
      );
      expect(observation.unchanged.map((item) => item.path).sort()).toEqual(paths.slice(6).sort());
      expect(await readFile(value.stateFile)).toEqual(before);
      expect((await readFile(value.wants, "utf8")).trim()).toBe("");
      const checkTrace = await readFile(value.trace, "utf8");
      const checkCommands = checkTrace.split("\n").filter(Boolean);
      expect(
        checkCommands.filter((line) => line.includes(" fetch ") && !line.includes("--stdin")),
      ).toHaveLength(1);
      expect(checkCommands.filter((line) => line.includes("ls-tree"))).toHaveLength(0);
      await value.clearTrace();
      const localReads = spyOn(gitObjects, "readBlob");
      await api.updateSkills(value.core, {
        source: "remote",
        paths: selectedPaths,
        exactRevision: targetRevision,
      });
      const trace = await readFile(value.trace, "utf8");
      expect(
        trace.split("\n").filter((line) => line.includes(" fetch ") && line.includes("--stdin")),
      ).toHaveLength(1);
      const wants = (await readFile(value.wants, "utf8")).trim().split("\n");
      const newMarkers = expected.filter((_, index) => index % 2 === 0);
      for (const id of new Set(newMarkers)) expect(wants).toContain(id);
      for (const id of excluded.filter((id) => !expected.includes(id)))
        expect(wants).not.toContain(id);
      const fetchedInput = await readFile(join(value.root, "fetch-wants"), "utf8");
      for (const id of new Set(expected)) {
        expect(fetchedInput.match(new RegExp(`\\b${id}\\b`, "gu")) ?? []).toHaveLength(
          newMarkers.includes(id) ? 1 : 0,
        );
        expect(localReads.mock.calls.filter(([request]) => request.oid === id)).toHaveLength(1);
      }
      expect(localReads.mock.calls.map(([request]) => request.oid).sort()).toEqual(
        [...new Set(expected)].sort(),
      );
      expect(trace).not.toMatch(/cat-file (?:blob|tree|commit|--batch(?:\s|$))/);
    } finally {
      await value.cleanup();
    }
  }, 30000);
}
test("W3 nested Remote install persists the actual full Root tree, not Source/repository tree", async () => {
  const value = await fixture();
  try {
    await value.install();
    const expectedTree = await value.git("rev-parse", `${value.first}:${sourceRoot}/${reviewPath}`);
    expect((await value.state()).installed[0]).toMatchObject({
      path: reviewPath,
      adoptedRevision: value.first,
      treeIdentity: { objectFormat: "sha1", objectId: expectedTree },
      identityEvidence: {
        status: "known",
        canonicalOrigin: origin,
        originRelativeSkillRoot: `${sourceRoot}/${reviewPath}`,
      },
    });
  } finally {
    await value.cleanup();
  }
});
test("W3 empty boundary Root persists full Origin coordinates and checks with metadata only at same C", async () => {
  const value = await fixture();
  try {
    await api.registerSource(value.core, {
      level: "project",
      id: "boundary",
      binding: { kind: "git", origin, root: `${sourceRoot}/${reviewPath}`, ref: "main" },
    });
    await api.installSkills(value.core, {
      source: "boundary",
      paths: [""],
      exactRevision: value.first,
    });
    expect((await value.state()).installed[0]).toMatchObject({
      path: "",
      treeIdentity: {
        objectFormat: "sha1",
        objectId: await value.git("rev-parse", `${value.first}:${sourceRoot}/${reviewPath}`),
      },
      identityEvidence: { originRelativeSkillRoot: `${sourceRoot}/${reviewPath}` },
    });
    await value.clearTrace();
    expect(
      (await api.checkUpdate(value.core, { source: "boundary" })).value.unchanged,
    ).toHaveLength(1);
    const trace = await readFile(value.trace, "utf8");
    expect(trace.split("\n").filter((line) => line.includes("ls-remote"))).toHaveLength(1);
    expect(
      trace.split("\n").filter((line) => line.includes(" fetch ") && !line.includes("--stdin")),
    ).toHaveLength(0);
    expect(trace.split("\n").filter((line) => line.includes("ls-tree"))).toHaveLength(0);
    expect((await readFile(value.wants, "utf8")).trim()).toBe("");
  } finally {
    await value.cleanup();
  }
});
test("W3 fully qualified branch ref resolves once and reuses cached exact metadata", async () => {
  const value = await fixture("refs/heads/main");
  try {
    await api.registerSource(value.core, {
      level: "project",
      id: "qualified",
      binding: { kind: "git", origin, root: sourceRoot, ref: "refs/heads/main" },
    });
    await api.installSkills(value.core, {
      source: "qualified",
      paths: [reviewPath],
      exactRevision: value.first,
    });
    await value.clearTrace();
    const result = await api.checkUpdate(value.core, { source: "qualified" });
    expect(result.value.unchanged).toEqual([expect.objectContaining({ path: reviewPath })]);
    const trace = await readFile(value.trace, "utf8");
    expect(trace.split("\n").filter((line) => line.includes("ls-remote"))).toHaveLength(1);
    expect(
      trace.split("\n").filter((line) => line.includes(" fetch ") && !line.includes("--stdin")),
    ).toHaveLength(0);
    expect((await readFile(value.wants, "utf8")).trim()).toBe("");
  } finally {
    await value.cleanup();
  }
});
test("W3 unchanged child tree is removed when a malformed ordinary ancestor shadows it", async () => {
  const value = await fixture();
  try {
    await value.install();
    await value.put("group/SKILL.md", "malformed ancestor\n");
    const revision = await value.commit("ancestor shadows unchanged child");
    expect(await value.git("rev-parse", `${revision}:${sourceRoot}/${reviewPath}`)).toBe(
      await value.git("rev-parse", `${value.first}:${sourceRoot}/${reviewPath}`),
    );
    const observation = await api.checkUpdate(value.core, { source: "remote" });
    expect(observation.value).toMatchObject({
      changed: [],
      unchanged: [],
      removed: [{ path: reviewPath }],
    });
    await api.updateSkills(value.core, {
      source: "remote",
      paths: [],
      remove: [reviewPath],
      exactRevision: revision,
    });
    expect((await value.state()).installed).toEqual([]);
  } finally {
    await value.cleanup();
  }
});
test("W3 unresolved and unavailable old revisions fail without content fallback", async () => {
  for (const unavailable of [false, true]) {
    const value = await fixture();
    try {
      await value.install();
      const state = await value.state();
      const installed = state.installed.map((item) => {
        if (item.kind === "local") return item;
        const { treeIdentity: _treeIdentity, adoptedRevision: _adoptedRevision, ...facts } = item;
        return unavailable
          ? { ...facts, adoptedRevision: "a".repeat(40) }
          : { ...facts, revisionStatus: "unresolved" };
      });
      await writeFile(value.stateFile, JSON.stringify({ ...state, version: 2, installed }));
      const before = await readFile(value.stateFile, "utf8");
      await value.clearTrace();
      await expect(api.checkUpdate(value.core, { source: "remote" })).rejects.toMatchObject({
        code: "PINNED_COMMIT_UNAVAILABLE",
      });
      expect(await readFile(value.stateFile, "utf8")).toBe(before);
      const wants = await readFile(value.wants, "utf8");
      expect(wants).not.toContain(
        await value.git("rev-parse", `${value.first}:${sourceRoot}/${reviewPath}/scripts/run.sh`),
      );
      expect(wants).not.toContain(
        await value.git("rev-parse", `${value.first}:${sourceRoot}/other/resource.txt`),
      );
    } finally {
      await value.cleanup();
    }
  }
});
test("W3 invalid selections and obsolete explicit baselines reject before remote acquisition", async () => {
  const value = await fixture();
  try {
    await value.install();
    for (const paths of [["other"], [reviewPath, reviewPath], ["../escape"], ["group//review"]]) {
      await value.clearTrace();
      await expect(
        api.updateSkills(value.core, { source: "remote", paths, exactRevision: value.first }),
      ).rejects.toMatchObject({
        code: paths[0] === "other" ? "SKILL_NOT_FOUND" : "INVALID_ARGUMENT",
      });
      expect(await readFile(value.trace, "utf8")).toBe("");
    }
    await value.clearTrace();
    await expect(
      api.updateSkills(value.core, {
        source: "remote",
        paths: [reviewPath],
        remove: [reviewPath],
        exactRevision: value.first,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      api.updateSkills(value.core, {
        source: "remote",
        paths: [reviewPath],
        exactRevision: value.first,
        expectedBaseline: "obsolete",
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    expect(await readFile(value.trace, "utf8")).toBe("");
  } finally {
    await value.cleanup();
  }
});
test("W3 supplied and omitted baselines reject Source-owned installation changes during preparation", async () => {
  for (const reviewed of [false, true]) {
    const value = await fixture();
    try {
      await value.install([reviewPath, "other"]);
      await value.put(`${reviewPath}/scripts/run.sh`, "changed selected content\n");
      const revision = await value.commit("reviewed update");
      const baseline = (await api.getUpdateBaseline(value.core, { source: "remote" })).value;
      const prepare = service.withPreparedSkills;
      spyOn(service, "withPreparedSkills").mockImplementation(async function <T>(
        context: service.SourceContext,
        paths: readonly string[],
        revision: string | undefined,
        operation: (skills: readonly service.PreparedSkill[]) => Promise<T>,
      ): Promise<T> {
        return prepare(context, paths, revision, async (skills) => {
          await api.uninstallSkills(value.core, { source: "remote", paths: ["other"] });
          return operation(skills);
        });
      });
      await expect(
        api.updateSkills(value.core, {
          source: "remote",
          paths: [reviewPath],
          exactRevision: revision,
          ...(reviewed ? { expectedBaseline: baseline } : {}),
        }),
      ).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
      expect((await value.state()).installed[0]).toMatchObject({
        path: reviewPath,
        adoptedRevision: value.first,
      });
    } finally {
      mock.restore();
      await value.cleanup();
    }
  }
});
test("W3 normal check is installed-only and compares resource and executable-mode tree changes", async () => {
  const value = await fixture();
  try {
    await value.install();
    const before = await readFile(value.stateFile, "utf8");
    await writeFile(join(value.work, "README.md"), "unrelated repository edit\n");
    const unrelated = await value.commit("unrelated commit");
    await value.clearTrace();
    const observation = await api.checkUpdate(value.core, { source: "remote" });
    expect(observation.value).toMatchObject({
      exactRevision: unrelated,
      added: [],
      changed: [],
      removed: [],
      unchanged: [{ path: reviewPath }],
    });
    const forbidden = await Promise.all([
      value.git("rev-parse", `${unrelated}:${sourceRoot}/${reviewPath}/scripts/run.sh`),
      value.git("rev-parse", `${unrelated}:${sourceRoot}/other/SKILL.md`),
      value.git("rev-parse", `${unrelated}:${sourceRoot}/other/resource.txt`),
    ]);
    const requests = await readFile(value.wants, "utf8");
    for (const oid of forbidden) expect(requests).not.toContain(oid);
    expect(
      (await readFile(value.trace, "utf8"))
        .split("\n")
        .filter((line) => line.includes("ls-remote")),
    ).toHaveLength(1);
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
    await value.put(`${reviewPath}/scripts/run.sh`, "#!/bin/sh\necho second\n");
    expect(
      (await readFile(value.trace, "utf8"))
        .split("\n")
        .filter((line) => line.includes(" init --bare ")),
    ).toHaveLength(0);
    await value.commit("resource-only change");
    expect((await api.checkUpdate(value.core, { source: "remote" })).value.changed).toEqual([
      expect.objectContaining({ path: reviewPath }),
    ]);
    await api.updateSkills(value.core, {
      source: "remote",
      paths: [reviewPath],
      exactRevision: await value.git("rev-parse", "HEAD"),
    });
    await chmod(join(value.work, sourceRoot, reviewPath, "scripts/run.sh"), 0o755);
    await value.commit("executable-mode-only change");
    expect((await api.checkUpdate(value.core, { source: "remote" })).value.changed).toEqual([
      expect.objectContaining({ path: reviewPath }),
    ]);
  } finally {
    await value.cleanup();
  }
});
test("W3 selected update ignores unselected invalid resources and retains independent versions and trees", async () => {
  const value = await fixture();
  try {
    await value.install([reviewPath, "other"]);
    const oldOther = (await value.state()).installed.find((item) => item.path === "other");
    await value.put(`${reviewPath}/SKILL.md`, "---\nname: renamed\ndescription: Second\n---\n");
    await symlink("/outside-root", join(value.work, sourceRoot, "other", "unsafe"));
    const selected = await value.commit("selected metadata and unselected unsafe resource");
    const unsafeBlob = await value.git("rev-parse", `${selected}:${sourceRoot}/other/unsafe`);
    await value.clearTrace();
    await api.updateSkills(value.core, {
      source: "remote",
      paths: [reviewPath],
      exactRevision: selected,
    });
    const state = await value.state();
    expect(state.installed.find((item) => item.path === "other")).toEqual(oldOther);
    expect(state.installed.find((item) => item.path === reviewPath)).toMatchObject({
      name: "review",
      description: "Second",
      adoptedRevision: selected,
      treeIdentity: {
        objectFormat: "sha1",
        objectId: await value.git("rev-parse", `${selected}:${sourceRoot}/${reviewPath}`),
      },
    });
    expect(await readFile(value.wants, "utf8")).not.toContain(unsafeBlob);
  } finally {
    await value.cleanup();
  }
});
test("W3 same-commit shortcut rejoins final binding guard and present-valid removal is rejected", async () => {
  const value = await fixture();
  try {
    await value.install();
    const before = await readFile(value.stateFile, "utf8");
    await expect(
      api.updateSkills(value.core, {
        source: "remote",
        paths: [],
        remove: [reviewPath],
        exactRevision: value.first,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
    const compare = service.compareSource;
    spyOn(service, "compareSource").mockImplementation(async (...args) => {
      const result = await compare(...args);
      await writeFile(join(value.root, "skctl.jsonc"), "{}\n");
      return result;
    });
    await expect(api.checkUpdate(value.core, { source: "remote" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
  } finally {
    await value.cleanup();
  }
});
test("W3 legacy missing-tree recovery uses retrievable old metadata without rewriting state", async () => {
  const value = await fixture();
  try {
    await value.install();
    const state = await value.state();
    const legacy = {
      ...state,
      version: 2,
      installed: state.installed.map((item) => {
        if (item.kind === "local") return item;
        const { treeIdentity: _treeIdentity, ...retained } = item;
        return retained;
      }),
    };
    await writeFile(value.stateFile, `${JSON.stringify(legacy, null, 2)}\n`);
    const before = await readFile(value.stateFile, "utf8");
    await writeFile(join(value.work, "README.md"), "new unrelated commit\n");
    const revision = await value.commit("legacy comparison target");
    await value.clearTrace();
    expect((await api.checkUpdate(value.core, { source: "remote" })).value).toMatchObject({
      changed: [],
      removed: [],
      added: [],
      unchanged: [{ path: reviewPath }],
    });
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
    const resource = await value.git(
      "rev-parse",
      `${revision}:${sourceRoot}/${reviewPath}/scripts/run.sh`,
    );
    expect(await readFile(value.wants, "utf8")).not.toContain(resource);
    await value.clearTrace();
    const trees = spyOn(gitObjects, "readTree");
    const closure = spyOn(GitObjects.prototype, "verifyTree");
    const restored = (
      await api.checkUpdate(value.core, { source: "remote", observation: "retained" })
    ).value;
    expect(restored?.unchanged.map((item) => item.path)).toEqual([reviewPath]);
    expect(restored?.exactRevision).toBe(revision);
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
    expect(closure).not.toHaveBeenCalled();
    expect(trees.mock.calls.length).toBeLessThanOrEqual(12);
    expect(await readFile(value.trace, "utf8")).not.toMatch(/built-in: git (?:fetch|ls-remote) /);
  } finally {
    await value.cleanup();
  }
});
test("W3 Local checks target installed Roots, tolerate malformed status, and guard removal revival", async () => {
  const root = await mkdtemp(join(tmpdir(), "w3-local-scope-"));
  const saved = process.env.SKCTL_STATE_DIR;
  process.env.SKCTL_STATE_DIR = join(root, "state");
  const skill = join(root, "skills", "group", "review");
  const unrelated = join(root, "skills", "unrelated");
  try {
    await mkdir(skill, { recursive: true });
    await mkdir(unrelated);
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: First\n---\n");
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    const core = { cwd: root, userConfigPath: join(root, "user.jsonc") };
    await api.registerSource(core, {
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await api.installSkills(core, { source: "local", paths: [reviewPath] });
    await writeFile(join(unrelated, "SKILL.md"), "---\nname: other\ndescription: Unrelated\n---\n");
    await chmod(unrelated, 0);
    expect((await api.checkUpdate(core, { source: "local" })).value).toMatchObject({
      added: [],
      unchanged: [{ path: reviewPath }],
    });
    await writeFile(join(skill, "SKILL.md"), "malformed own marker\n");
    await chmod(skill, 0);
    await expect(api.checkUpdate(core, { source: "local" })).rejects.toThrow();
    await chmod(skill, 0o700);
    expect((await api.checkUpdate(core, { source: "local" })).value.removed).toEqual([
      expect.objectContaining({ path: reviewPath }),
    ]);
    const remove = service.assertRemovedSkills;
    const inspection = spyOn(service, "assertRemovedSkills").mockImplementation(async (...args) => {
      await remove(...args);
      await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Revived\n---\n");
    });
    await expect(
      api.updateSkills(core, { source: "local", paths: [], remove: [reviewPath] }),
    ).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    expect((await api.getWorkspace(core)).value.installedSkills).toHaveLength(1);
    inspection.mockRestore();
    await writeFile(join(root, "skills", "group", "SKILL.md"), "malformed ancestor\n");
    expect((await api.checkUpdate(core, { source: "local" })).value.removed).toHaveLength(1);
  } finally {
    if (saved === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = saved;
    await chmod(unrelated, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});
test("W3 empty Installed Source checks have no remote work but still rejoin the final guard", async () => {
  const value = await fixture();
  try {
    await value.clearTrace();
    expect((await api.checkUpdate(value.core, { source: "remote" })).value).toMatchObject({
      changed: [],
      removed: [],
      unchanged: [],
      added: [],
    });
    expect(await readFile(value.trace, "utf8")).toBe("");
    const compare = service.compareSource;
    spyOn(service, "compareSource").mockImplementation(async (...args) => {
      const result = await compare(...args);
      await writeFile(join(value.root, "skctl.jsonc"), "{}\n");
      return result;
    });
    await expect(api.checkUpdate(value.core, { source: "remote" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
  } finally {
    await value.cleanup();
  }
});
test("W3 malformed own metadata is changed, cannot be removed, and fails update validation", async () => {
  const value = await fixture();
  try {
    await value.install();
    await api.createCollection(value.core, { level: "project", collection: "team" });
    await api.addMember(value.core, {
      level: "project",
      collection: "team",
      name: "review",
      address: { source: "remote", path: reviewPath },
    });
    await value.put(`${reviewPath}/SKILL.md`, "malformed own marker\n");
    const revision = await value.commit("malformed root");
    const before = await readFile(value.stateFile, "utf8");
    expect((await api.checkUpdate(value.core, { source: "remote" })).value).toMatchObject({
      changed: [{ path: reviewPath }],
      removed: [],
    });
    await expect(
      api.updateSkills(value.core, {
        source: "remote",
        paths: [reviewPath],
        exactRevision: revision,
      }),
    ).rejects.toThrow();
    await expect(
      api.updateSkills(value.core, {
        source: "remote",
        paths: [],
        remove: [reviewPath],
        exactRevision: revision,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
  } finally {
    await value.cleanup();
  }
});
test("W3 Remote reinstall preserves first-install name and target metadata validates independently", async () => {
  const value = await fixture();
  try {
    await value.install();
    await value.put(`${reviewPath}/SKILL.md`, "---\nname: other\ndescription: Reinstalled\n---\n");
    const revision = await value.commit("renamed root");
    await api.installSkills(value.core, {
      source: "remote",
      paths: [reviewPath],
      exactRevision: revision,
    });
    expect((await value.state()).installed[0]).toMatchObject({
      name: "review",
      description: "Reinstalled",
      adoptedRevision: revision,
    });
  } finally {
    await value.cleanup();
  }
});
test("W3 legacy old-revision transport failure fails instead of authorizing digest fallback or removal", async () => {
  const value = await fixture();
  try {
    await value.install();
    const state = await value.state();
    const installed = state.installed.map((item) => {
      if (item.kind === "local") return item;
      const { treeIdentity: _treeIdentity, ...retained } = item;
      return { ...retained, adoptedRevision: "a".repeat(40) };
    });
    await writeFile(value.stateFile, JSON.stringify({ ...state, version: 2, installed }));
    const before = await readFile(value.stateFile, "utf8");
    // Transparent shim delegates all real work except the actual unavailable-old
    // fetch, where it reports a transport failure instead of a missing object.
    const shim = (process.env.PATH ?? "").split(":")[0]!;
    const original = await readFile(join(shim, "git"), "utf8");
    await writeFile(
      join(shim, "git"),
      original.replace(
        "capture=no",
        `case "$*" in *fetch*${"a".repeat(40)}*) echo 'Failed to connect to proxy' >&2; exit 1 ;; esac\ncapture=no`,
      ),
    );
    await value.clearTrace();
    await expect(api.checkUpdate(value.core, { source: "remote" })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
    expect(await readFile(value.wants, "utf8")).not.toContain(
      await value.git("rev-parse", `${value.first}:${sourceRoot}/${reviewPath}/scripts/run.sh`),
    );
  } finally {
    await value.cleanup();
  }
});
test("W3 persisted comparison evidence with contradictory full Origin identity fails closed", async () => {
  const value = await fixture();
  try {
    await value.install();
    const state = await value.state();
    const installed = state.installed.map((item) => ({
      ...item,
      identityEvidence: {
        status: "known",
        canonicalOrigin: origin,
        originRelativeSkillRoot: "wrong/root",
      },
    }));
    await writeFile(value.stateFile, JSON.stringify({ ...state, installed }));
    await value.clearTrace();
    await expect(api.checkUpdate(value.core, { source: "remote" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await readFile(value.trace, "utf8")).toBe("");
  } finally {
    await value.cleanup();
  }
});
test("W3 genuine tree change with normalized equal Snapshot digest still advances selected evidence", async () => {
  const value = await fixture();
  try {
    await value.install();
    const before = (await value.state()).installed[0]!;
    async function inputGit(input: string, ...args: string[]) {
      const child = Bun.spawn({
        cmd: ["/usr/bin/git", ...args],
        cwd: value.work,
        stdin: Buffer.from(input),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [output, error, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (status) throw new Error(error);
      return output.trim();
    }
    const empty = await inputGit("", "mktree");
    let tree = await inputGit(
      `${await value.git("ls-tree", `${value.first}:${sourceRoot}/${reviewPath}`)}\n040000 tree ${empty}\tempty-directory\n`,
      "mktree",
    );
    // Replace only the selected child's tree up to the repository root. Git can
    // represent empty tracked trees although ordinary index checkout cannot.
    for (const [parent, child] of [
      [`${sourceRoot}/group`, "review"],
      [sourceRoot, "group"],
      ["library", "skills"],
      ["", "library"],
    ]) {
      const entries = await value.git(
        "ls-tree",
        parent ? `${value.first}:${parent}` : `${value.first}^{tree}`,
      );
      const replaced = entries
        .split("\n")
        .map((line) => (line.endsWith(`\t${child}`) ? `040000 tree ${tree}\t${child}` : line));
      tree = await inputGit(`${replaced.join("\n")}\n`, "mktree");
    }
    const revision = await inputGit("empty tree change\n", "commit-tree", tree, "-p", value.first);
    await value.git("push", "origin", `${revision}:main`);
    expect((await api.checkUpdate(value.core, { source: "remote" })).value.changed).toHaveLength(1);
    await api.updateSkills(value.core, {
      source: "remote",
      paths: [reviewPath],
      exactRevision: revision,
    });
    const after = (await value.state()).installed[0]!;
    expect(after.digest).toBe(before.digest);
    expect(after).toMatchObject({
      adoptedRevision: revision,
      treeIdentity: {
        objectId: await value.git("rev-parse", `${revision}:${sourceRoot}/${reviewPath}`),
      },
    });
  } finally {
    await value.cleanup();
  }
});
test("W3 effective repository name collisions use retained installed metadata without unselected content", async () => {
  const value = await fixture();
  try {
    const core = {
      cwd: value.root,
      userConfigPath: join(value.root, "user.jsonc"),
      sourceTransport: () => pathToFileURL(value.bare).href,
    };
    await api.registerSource(core, {
      level: "project",
      id: "repository",
      binding: {
        kind: "git",
        origin: "https://github.com/acme/w3.git",
        root: sourceRoot,
        ref: "main",
      },
    });
    await api.installSkills(core, {
      source: "repository",
      paths: [reviewPath, "other"],
      exactRevision: value.first,
    });
    await value.put(
      `${reviewPath}/SKILL.md`,
      "---\nname: other\ndescription: Renamed but stable\n---\n",
    );
    const renamed = await value.commit("target name differs from stable entry");
    await api.installSkills(core, {
      source: "repository",
      paths: [reviewPath],
      exactRevision: renamed,
    });
    expect((await value.state()).installed.find((item) => item.path === reviewPath)?.name).toBe(
      "review",
    );
    await value.put("new/SKILL.md", "---\nname: other\ndescription: Conflicting new entry\n---\n");
    const conflicting = await value.commit("new collision");
    const before = await readFile(value.stateFile, "utf8");
    await value.clearTrace();
    await expect(
      api.installSkills(core, { source: "repository", paths: ["new"], exactRevision: conflicting }),
    ).rejects.toMatchObject({ code: "EXPOSURE_CONFLICT" });
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
    expect(await readFile(value.wants, "utf8")).not.toContain(
      await value.git("rev-parse", `${conflicting}:${sourceRoot}/other/resource.txt`),
    );
  } finally {
    await value.cleanup();
  }
});
for (const operation of ["check", "install", "update"] as const) {
  test(`W3 M1 Local ${operation} rejects an intermediate Source Root symlink without reading outside bytes`, async () => {
    const value = await localReviewFixture();
    const outside = join(value.root, "outside");
    const readSpy = spyOn(filesystem, "readFile");
    try {
      // Keep Origin lexical and the final boundary directory ordinary. Only the
      // intermediate declared Root component is replaced by an escaping link.
      await rename(join(value.localOrigin, "library"), outside);
      await symlink(outside, join(value.localOrigin, "library"));
      await writeFile(join(outside, "skills", "one", "resource.txt"), "Outside changed bytes\n");
      const before = await readFile(value.stateFile, "utf8");
      expect(readSpy.mock.calls.some(([path]) => path === value.stateFile)).toBe(true);
      readSpy.mockClear();
      const pending =
        operation === "check"
          ? api.checkUpdate(value.core, { source: "local-review" })
          : operation === "install"
            ? api.installSkills(value.core, { source: "local-review", paths: ["one"] })
            : api.updateSkills(value.core, { source: "local-review", paths: ["one"] });
      const outcome = await pending.then(
        () => ({ code: "UNEXPECTED_SUCCESS" }),
        (error) => error,
      );
      // Unsafe Source prefixes are acquisition integrity failures, not authorized
      // missing Installed Roots. Otherwise removal could cross this same link.
      expect(outcome).toMatchObject({ code: "PROVIDER_INTEGRITY_FAILED" });
      const outsideReads = readSpy.mock.calls.filter(
        ([path]) =>
          typeof path === "string" &&
          (path.startsWith(`${join(value.localOrigin, "library")}/`) ||
            path.startsWith(`${outside}/`)),
      );
      expect(outsideReads).toEqual([]);
      expect(await readFile(value.stateFile, "utf8")).toBe(before);
    } finally {
      readSpy.mockRestore();
      await value.cleanup();
    }
  });
}
test("W3 M1 Local prefix validation keeps marker shadowing inside the Source boundary and Origin lexical", async () => {
  const value = await localReviewFixture();
  try {
    const before = await readFile(value.stateFile, "utf8");
    await writeFile(join(value.localOrigin, "SKILL.md"), "malformed outside-boundary ancestor\n");
    await writeFile(
      join(value.localOrigin, "library", "SKILL.md"),
      "another outside-boundary marker\n",
    );
    expect((await api.checkUpdate(value.core, { source: "local-review" })).value).toMatchObject({
      changed: [],
      removed: [],
      unchanged: [{ path: "one" }],
    });
    await api.installSkills(value.core, { source: "local-review", paths: ["two"] });
    expect((await api.getWorkspace(value.core)).value.effective.sources[0]?.origin).toBe(
      value.localOrigin,
    );
    await writeFile(join(value.boundary, "SKILL.md"), "malformed ordinary boundary marker\n");
    expect(
      (await api.checkUpdate(value.core, { source: "local-review" })).value.removed,
    ).toHaveLength(2);
    const installed = JSON.parse(await readFile(value.stateFile, "utf8")).installed;
    expect(installed[0]).toEqual(JSON.parse(before).installed[0]);
  } finally {
    await value.cleanup();
  }
});
for (const changed of ["resource", "marker"] as const) {
  test(`W3 M2 multi-Root Local reinstall rejects ${changed} drift after the first captured digest`, async () => {
    const value = await localReviewFixture();
    const originalDigest = directory.digestDirectory;
    const one = join(value.boundary, "one");
    const two = join(value.boundary, "two");
    let mutations = 0;
    const digestSpy = spyOn(directory, "digestDirectory").mockImplementation(async function (root) {
      // Delegate every hash to the actual coordinator. Observing the second
      // selected Root proves the first Root's metadata AND full digest have
      // already been captured; no sleep or synthetic digest controls the race.
      const digest = await originalDigest(root);
      if (root === two && mutations === 0) {
        mutations++;
        await writeFile(
          join(one, changed === "resource" ? "resource.txt" : "SKILL.md"),
          changed === "resource"
            ? "Changed between selected Roots\n"
            : "---\nname: renamed\ndescription: Changed between selected Roots\n---\n",
        );
      }
      return digest;
    });
    try {
      const before = await readFile(value.stateFile, "utf8");
      const outcome = await api
        .installSkills(value.core, { source: "local-review", paths: ["one", "two"] })
        .then(
          () => ({ code: "UNEXPECTED_SUCCESS" }),
          (error) => error,
        );
      expect(mutations).toBe(1);
      expect(outcome).toMatchObject({ code: "TRANSACTION_CONFLICT" });
      expect(await readFile(value.stateFile, "utf8")).toBe(before);
      expect(JSON.parse(await readFile(value.stateFile, "utf8")).installed).toEqual(
        JSON.parse(before).installed,
      );
    } finally {
      digestSpy.mockRestore();
      await value.cleanup();
    }
  });
}
test("W3 M2 Local metadata read and its full digest must describe the same marker bytes", async () => {
  const value = await localReviewFixture();
  const originalDigest = directory.digestDirectory;
  const one = join(value.boundary, "one");
  let mutations = 0;
  let hashes = 0;
  const digestSpy = spyOn(directory, "digestDirectory").mockImplementation(async function (root) {
    // localRoot has already parsed original SKILL.md here. Its actual digest
    // now sees changed marker bytes, exercising the metadata/hash window itself.
    if (root === one && ++hashes === 2) {
      mutations++;
      await writeFile(
        join(one, "SKILL.md"),
        "---\nname: renamed\ndescription: Changed during marker hash\n---\n",
      );
    }
    return originalDigest(root);
  });
  try {
    const before = await readFile(value.stateFile, "utf8");
    const outcome = await api
      .installSkills(value.core, { source: "local-review", paths: ["one"] })
      .then(
        () => ({ code: "UNEXPECTED_SUCCESS" }),
        (error) => error,
      );
    expect(mutations).toBe(1);
    expect(outcome).toMatchObject({ code: "TRANSACTION_CONFLICT" });
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
  } finally {
    digestSpy.mockRestore();
    await value.cleanup();
  }
});
