import { describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildMetadata, pluginPackageFiles } from "../../scripts/build";
import {
  expectedArtifactName,
  packagedChecks,
  parseSmokeOptions,
  runPackagedSmoke,
  terminalControllerSource,
} from "./smoke";

const root = resolve(import.meta.dir, "../..");
const version = (await Bun.file(join(root, "packages/skctl/package.json")).json())
  .version as string;

describe("packaged release orchestration", () => {
  test("legacy UI journeys require an explicit opt-in instead of claiming default coverage", () => {
    const argv = [
      "--artifact",
      join(root, "dist", expectedArtifactName()),
      "--tui-artifact",
      join(root, "dist", buildMetadata.tuiArtifact),
      "--output-root",
      join(root, "tmp", "legacy-smoke-fixture"),
    ];
    expect(parseSmokeOptions(argv).legacyJourneys).toBeUndefined();
    expect(parseSmokeOptions([...argv, "--legacy-journeys"]).legacyJourneys).toBe(true);
  });
  test("publishes import-safe native and plugin build metadata", () => {
    expect(buildMetadata.nativeArtifact).toBe(expectedArtifactName());
    expect(buildMetadata.tuiArtifact).toBe(expectedArtifactName().replace("skctl-", "sktui-"));
    expect(buildMetadata.nativeTarget).toBe(
      `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}-modern`,
    );
    expect(buildMetadata.pluginEntry).toBe("opencode-adapter.js");
    expect(buildMetadata.pluginDeclaration).toBe("dist/index.d.ts");
    expect(pluginPackageFiles).toEqual([
      "dist/index.d.ts",
      "dist/index.js",
      "dist/process.d.ts",
      "package.json",
    ]);
    expect(packagedChecks.map((check) => check.name)).toEqual([
      "native-artifact",
      "local-register-discover-install",
      "collection-use-managed-agent-browse-load-read",
      "agent-run",
      "agent-download",
      "tui-start-render-input-exit",
      "cli-without-tui-and-installed-handoff",
    ]);
  });

  test("requires absolute artifact and fresh absolute operation output roots", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "skctl-packaged-test-"));
    try {
      expect(() =>
        parseSmokeOptions(["--artifact", "relative", "--output-root", outputRoot]),
      ).toThrow("absolute");
      expect(() =>
        parseSmokeOptions(["--artifact", join(root, "dist", expectedArtifactName())]),
      ).toThrow("output-root");
      const options = parseSmokeOptions([
        "--artifact",
        join(root, "dist", expectedArtifactName()),
        "--tui-artifact",
        join(root, "dist", buildMetadata.tuiArtifact),
        "--output-root",
        outputRoot,
      ]);
      expect(isAbsolute(options.artifact)).toBe(true);
      expect(options.outputRoot).toBe(outputRoot);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("evidence-only invocation rebuilds and records the supplied manifest", () => {
    const evidenceDir = "/tmp/opencode/skctl-evidence-options";
    const manifest = join(evidenceDir, "worktree-manifest.json");
    const options = parseSmokeOptions(["--evidence-dir", evidenceDir, "--manifest", manifest]);
    expect(options).toMatchObject({
      evidenceDir,
      manifest,
      buildForEvidence: true,
      outputRoot: join(evidenceDir, "fixture-runtime"),
    });
    expect(options.artifact).toBe(join(root, "dist", expectedArtifactName()));
    expect(options.tuiArtifact).toBe(join(root, "dist", buildMetadata.tuiArtifact));
    expect(() =>
      parseSmokeOptions(["--evidence-dir", evidenceDir, "--manifest", "relative"]),
    ).toThrow("absolute");
  });

  test("qualifies foreign artifacts without claiming a foreign host run", () => {
    expect(expectedArtifactName("linux", "x64")).toBe("skctl-linux-x64");
    expect(expectedArtifactName("darwin", "arm64")).toBe("skctl-darwin-arm64");
    expect(expectedArtifactName("win32", "x64")).toBe("skctl-windows-x64.exe");
  });

  test("Windows controller is render-gated and boundedly drains every owned resource", () => {
    const controller = terminalControllerSource("win32");
    expect(controller).toContain("CreatePseudoConsole");
    expect(controller).toContain("if (screen && !screenAt)");
    expect(controller).toContain("WriteFile(inputWrite, &ctrlc, 1, &wrote, NULL) && wrote == 1");
    expect(controller).toContain("GetTickCount64() - start >= 10000");
    expect(controller).toContain("GetTickCount64() - drainStart >= 2000");
    expect(controller).toContain("close_handle(&inputRead); close_handle(&outputWrite);");
    expect(controller).toContain("DeleteProcThreadAttributeList");
    expect(controller).toContain("HeapFree(GetProcessHeap(), 0, startup.lpAttributeList)");
    expect(controller).toContain(
      "close_handle(&process.hThread); close_handle(&process.hProcess);",
    );
    expect(controller).toContain(
      'snprintf(command, sizeof(command), "%c%s%c %s", 34, argv[1], 34, argc == 4 ? argv[3] : "")',
    );
    const inputClose = controller.indexOf("close_handle(&inputWrite);");
    const consoleClose = controller.indexOf("close_console(&console);");
    expect(consoleClose).toBeGreaterThan(inputClose);
    expect(controller.indexOf("PeekNamedPipe(outputRead", consoleClose)).toBeGreaterThan(
      consoleClose,
    );
    expect(controller).not.toContain(
      "while (ReadFile(outputRead, buffer, sizeof(buffer), &read, NULL) && read)",
    );
  });

  test("records executable artifact digests and extracts an allowlisted plugin package", async () => {
    const artifact = join(root, "dist", buildMetadata.nativeArtifact);
    const sums = await readFile(join(root, "dist", "SHA256SUMS"), "utf8");
    const digest = new Bun.CryptoHasher("sha256").update(await readFile(artifact)).digest("hex");
    const metadata = JSON.parse(
      await readFile(join(root, "dist", "release-metadata.json"), "utf8"),
    );
    if (process.platform !== "win32") expect((await stat(artifact)).mode & 0o111).not.toBe(0);
    expect(sums).toContain(`${digest}  ${buildMetadata.nativeArtifact}`);
    expect(metadata.binaries.cli).toMatchObject({ path: buildMetadata.nativeArtifact, digest });
    const tuiPath = join(root, "dist", buildMetadata.tuiArtifact);
    const tuiDigest = new Bun.CryptoHasher("sha256").update(await readFile(tuiPath)).digest("hex");
    expect(sums).toContain(`${tuiDigest}  ${buildMetadata.tuiArtifact}`);
    expect(metadata.binaries.tui).toMatchObject({
      path: buildMetadata.tuiArtifact,
      digest: tuiDigest,
    });
    const output = await mkdtemp(join(tmpdir(), "skctl-plugin-extract-"));
    const pluginOutput = await mkdtemp(join(tmpdir(), "skctl-plugin-build-"));
    try {
      const build = Bun.spawn([
        process.execPath,
        "scripts/build.ts",
        "plugin",
        "--output-root",
        pluginOutput,
      ]);
      expect(await build.exited).toBe(0);
      expect((await stat(join(pluginOutput, "opencode-adapter.js"))).isFile()).toBe(true);
      const unpack = Bun.spawn([
        "tar",
        "-xzf",
        join(pluginOutput, "opencode-adapter.tgz"),
        "-C",
        output,
      ]);
      expect(await unpack.exited).toBe(0);
      const packageRoot = join(output, "package");
      expect(
        (await readdir(packageRoot, { recursive: true })).filter((path) => path !== "dist").sort(),
      ).toEqual([...pluginPackageFiles].sort());
      const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
      expect(manifest.name).toBe("@skctl/opencode-adapter");
      expect(manifest.version).toBe(version);
      const exported = await import(
        `${pathToFileURL(join(packageRoot, "dist/index.js")).href}?test=${Date.now()}`
      );
      expect(Object.keys(exported)).toEqual(["default"]);
      expect(typeof exported.default).toBe("function");
    } finally {
      await rm(output, { recursive: true, force: true });
      await rm(pluginOutput, { recursive: true, force: true });
    }
  });

  test("rejects foreign release output and preserves generated artifacts", async () => {
    const output = await mkdtemp(join(tmpdir(), "skctl-native-release-"));
    try {
      await writeFile(join(output, "foreign-artifact"), "foreign");
      const rejected = Bun.spawn(
        [process.execPath, "scripts/build.ts", "native", "--output-root", output],
        { stdout: "ignore", stderr: "ignore" },
      );
      expect(await rejected.exited).not.toBe(0);
      expect(await Bun.file(join(output, "foreign-artifact")).text()).toBe("foreign");
      await rm(join(output, "foreign-artifact"));
      await writeFile(join(output, buildMetadata.nativeArtifact), "stale");
      const built = Bun.spawn([
        process.execPath,
        "scripts/build.ts",
        "cli",
        "--output-root",
        output,
      ]);
      expect(await built.exited).toBe(0);
      expect((await readdir(output)).sort()).toEqual([
        "SHA256SUMS",
        "release-metadata.json",
        buildMetadata.nativeArtifact,
      ]);
      const builtTui = Bun.spawn([
        process.execPath,
        "scripts/build.ts",
        "tui",
        "--output-root",
        output,
      ]);
      expect(await builtTui.exited).toBe(0);
      const metadata = JSON.parse(await readFile(join(output, "release-metadata.json"), "utf8"));
      expect(Object.keys(metadata.artifacts)).toEqual([
        buildMetadata.nativeArtifact,
        buildMetadata.tuiArtifact,
      ]);
      expect(await Bun.file(join(output, buildMetadata.nativeArtifact)).text()).not.toBe("stale");
      const plugin = join(output, "opencode-adapter.js");
      await writeFile(plugin, "plugin");
      const rebuilt = Bun.spawn([
        process.execPath,
        "scripts/build.ts",
        "cli",
        "--output-root",
        output,
      ]);
      expect(await rebuilt.exited).toBe(0);
      expect(await Bun.file(plugin).text()).toBe("plugin");
      expect(await Bun.file(join(output, buildMetadata.tuiArtifact)).exists()).toBe(true);
      expect(await Bun.file(join(output, "SHA256SUMS")).text()).toContain("opencode-adapter.js");
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }, 30_000);

  test("runs observable packaged actions and removes only its owned fixture root", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "skctl-packaged-smoke-"));
    const artifact = join(root, "dist", buildMetadata.nativeArtifact);
    try {
      await runPackagedSmoke({
        artifact,
        tuiArtifact: join(root, "dist", buildMetadata.tuiArtifact),
        outputRoot,
      });
      expect(await lstat(outputRoot).catch(() => undefined)).toBeUndefined();
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }, 180_000);
});
