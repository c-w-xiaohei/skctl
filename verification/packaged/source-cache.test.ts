import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { networkFixture } from "../../packages/skill-core/test/provider/network-fixture";
import { buildMetadata } from "../../scripts/build";

test("packaged CLI processes share filtered objects and reinstall an exact revision offline", async () => {
  const fixture = await networkFixture();
  const root = await mkdtemp(join(tmpdir(), "skctl-packaged-source-"));
  const project = join(root, "project"),
    stateRoot = join(root, "state");
  const cli = resolve("dist", buildMetadata.nativeArtifact);
  const environment = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    SKCTL_STATE_DIR: stateRoot,
    SKCTL_SOURCE_CACHE_DIR: join(root, "cache"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    http_proxy: "",
    https_proxy: "",
    all_proxy: "",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: "127.0.0.1",
    no_proxy: "127.0.0.1",
  };
  const command = async (...args: string[]) => {
    const child = Bun.spawn([cli, "--project", project, ...args], {
      cwd: project,
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    return stdout;
  };
  let open = true;
  try {
    await mkdir(project);
    await mkdir(environment.HOME);
    await command("--help");
    await command("source", "--help");
    await command("source", "register", "--help");
    await command("source", "discover", "--help");
    await command("install", "--help");
    await command("update", "--help");
    await command("update", "check", "--help");
    await command(
      "source",
      "register",
      "git",
      "team",
      fixture.targetUrl,
      "--ref",
      "main",
      "--root",
      "",
      "--scope",
      "project",
    );
    const first = JSON.parse(await command("source", "discover", "team", "--json"));
    expect(first.exactRevision).toBe(fixture.commit);
    expect(first.candidates).toEqual([{ path: "", name: "network", description: "Network" }]);
    const observedTransfers = fixture.transfers.length,
      requests = fixture.direct;
    expect(observedTransfers).toBe(2);
    expect(JSON.parse(await command("source", "discover", "team", "--json"))).toEqual(first);
    expect(fixture.direct).toBe(requests);
    await command("install", "team", "", "--revision", fixture.commit);
    expect(fixture.transfers).toHaveLength(observedTransfers + 1);
    const transfer = fixture.transfers.at(-1)!;
    expect(transfer.wants).not.toContain(fixture.selectedBlob);
    expect(transfer.wants).not.toContain(fixture.historicalBlob);
    expect(fixture.transfers.flatMap((item) => item.objects)).not.toContain(
      `${fixture.historicalBlob} blob`,
    );
    const state = JSON.parse(await readFile(join(stateRoot, "state.json"), "utf8"));
    const installed = state.installed[0];
    const snapshot = join(stateRoot, "snapshots", installed.snapshotId, "root");
    expect(installed).toMatchObject({ source: "team", path: "", adoptedRevision: fixture.commit });
    const checkRequests = fixture.direct;
    const checked = JSON.parse(await command("update", "check", "team", "--json"));
    expect(checked.unchanged).toEqual([{ path: "", name: "network", description: "Network" }]);
    expect(checked.changed).toEqual([]);
    expect(JSON.parse(await command("update", "check", "team", "--json"))).toEqual(checked);
    expect(fixture.direct).toBe(checkRequests);
    expect(await readFile(join(snapshot, "copy.md"), "utf8")).toBe(
      await readFile(join(snapshot, "SKILL.md"), "utf8"),
    );
    const count = fixture.direct;
    await fixture.close();
    open = false;
    await command("install", "team", "", "--revision", fixture.commit);
    expect(fixture.direct).toBe(count);
    expect((await stat(join(snapshot, "SKILL.md"))).isFile()).toBe(true);
  } finally {
    if (open) await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
