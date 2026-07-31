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
const version = (await Bun.file(join(root, "packages/skill-cli/package.json")).json())
  .version as string;

describe("packaged release orchestration", () => {
  test("publishes import-safe native and plugin build metadata", () => {
    expect(buildMetadata.nativeArtifact).toBe(expectedArtifactName());
    expect(buildMetadata.nativeTarget).toBe(
      `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}-modern`,
    );
    expect(buildMetadata.pluginEntry).toBe("dist/index.js");
    expect(buildMetadata.pluginDeclaration).toBe("dist/index.d.ts");
    expect(pluginPackageFiles).toEqual([
      "dist/index.d.ts",
      "dist/index.js",
      "dist/process.d.ts",
      "dist/prompt.d.ts",
      "package.json",
    ]);
  });

  test("defines exactly the six named packaged checks in release order", () => {
    expect(packagedChecks.map((check) => check.name)).toEqual([
      "native-artifact",
      "local-register-discover-install",
      "collection-use-managed-agent-browse-load-read",
      "agent-run",
      "agent-download",
      "tui-start-render-input-exit",
    ]);
  });

  test("requires absolute artifact and fresh absolute operation output roots", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "skill-cli-packaged-test-"));
    try {
      expect(() =>
        parseSmokeOptions(["--artifact", "relative", "--output-root", outputRoot]),
      ).toThrow("absolute");
      expect(() =>
        parseSmokeOptions(["--artifact", join(root, "dist", "skill-cli-linux-x64")]),
      ).toThrow("output-root");
      const options = parseSmokeOptions([
        "--artifact",
        join(root, "dist", "skill-cli-linux-x64"),
        "--output-root",
        outputRoot,
      ]);
      expect(isAbsolute(options.artifact)).toBe(true);
      expect(options.outputRoot).toBe(outputRoot);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("qualifies every native artifact name without claiming a foreign host run", () => {
    expect(expectedArtifactName("linux", "x64")).toBe("skill-cli-linux-x64");
    expect(expectedArtifactName("darwin", "arm64")).toBe("skill-cli-darwin-arm64");
    expect(expectedArtifactName("win32", "x64")).toBe("skill-cli-windows-x64.exe");
  });

  test("uses platform-native controllers that write terminal Ctrl-C input after render output", () => {
    for (const target of ["linux", "darwin", "win32"] as const) {
      const controller = terminalControllerSource(target);
      expect(controller).toContain("ctrlc = 3");
      expect(controller).toContain("?1049h");
      expect(controller).toContain("10000");
      expect(controller).not.toContain("kill(child, SIGINT)");
      expect(controller).not.toContain("OPEN_ENVIRONMENT_ONLY");
    }
    expect(terminalControllerSource("linux")).toContain("forkpty");
    expect(terminalControllerSource("darwin")).toContain("forkpty");
    expect(terminalControllerSource("win32")).toContain("CreatePseudoConsole");
    expect(terminalControllerSource("win32")).toContain("WriteFile(inputWrite");
  });

  test("keeps the Linux controller aligned with the refactored TUI acceptance paths", () => {
    const controller = terminalControllerSource("linux");

    expect(controller).toContain('cold = !strcmp(argv[4], "cold")');
    expect(controller).toContain('checkpoint("cold-start", "Add your first Skill")');
    expect(controller).toContain('checkpoint("cold-action", "Add a Source")');
    expect(controller).toContain('checkpoint("cold-instructions", "Discover")');
    expect(controller).toContain("PTY cold-start Enter mutated project config");
    expect(controller).toContain('checkpoint("source-palette", "Global")');
    expect(controller).toContain('checkpoint("source-config", "Config")');
    expect(controller).toContain(
      'checkpoint("source-actions", "Add Source"); send_bytes(master, "\\033[B\\033[B\\033[B\\033[B\\033[B\\r")',
    );
    expect(controller).toContain(
      'checkpoint("add-source", "Add Source"); send_bytes(master, "\\033[B\\033[B\\033[B\\033[B\\033[B\\r")',
    );
    expect(controller).toContain('send_bytes(master, "\\033[C")');
    expect(controller).toContain("resize_pty(master, child, 80, 24)");
    expect(controller).toContain("resize_pty(master, child, 43, 24)");
    expect(controller).toContain('checkpoint("reader-tabs", "SKILL.md")');
    expect(controller).toContain('checkpoint("reader-details", "Details")');
    expect(controller).toContain('send_bytes(master, "\\033[C\\033[C")');
    expect(controller).toContain('checkpoint("reader-actions", "Actions")');
    expect(controller).toContain('checkpoint("global-collections-empty", "No Collections yet")');
    expect(controller).toContain('checkpoint("new-collection-action", "Create Collection")');
    expect(controller).toContain(
      'checkpoint("restored-form", "Create Collection"); send_bytes(master, "pty-created")',
    );
    expect(controller).toContain('send_bytes(master, "\\t")');
    expect(controller).toContain('send_bytes(master, "\\033[B\\r")');
    expect(controller).toContain('checkpoint("created", "pty-created")');
    expect(controller).toContain('send_bytes(master, "\\020")');
    expect(controller).toContain('checkpoint("collection-actions", "Add Link")');
    expect(controller).toContain('checkpoint("collection-remove-action", "Remove Collection")');
    expect(controller).toContain('checkpoint("remove-review", "Remove Collection")');
    expect(controller).toContain(
      'send_bytes(master, "\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B")',
    );
    expect(controller).toContain(
      'send_bytes(master, "\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B")',
    );
    expect(controller).toContain('checkpoint("collection-actions-repeat", "Add Link")');
    expect(controller).toContain('checkpoint("global destination", "Global Config")');
    expect(controller).toContain(
      'checkpoint("startup", "Workspace") || !checkpoint("skills", "Installed Skills") || !checkpoint("fixture", "fixture"); send_bytes(master, "\\033"); step++;',
    );
    expect(controller).toContain(
      'step == 1 && elapsed - alternateAt >= 2200) { send_bytes(master, "\\033"); step++; }',
    );
    expect(controller).toContain(
      'checkpoint("global selected", "Global Config") || !checkpoint("global destination", "Global Config"); send_bytes(master, "\\t"); step++;',
    );
    expect(controller).toContain(
      'checkpoint("global-sections", "Sources"); send_bytes(master, "\\033[C\\033[C"); step++;',
    );
    expect(controller).toContain('send_bytes(master, "\\t")');
    expect(controller).toContain('level_has(argv[2], "global", "pty-created")');
    expect(controller).toContain('checkpoint("mouse-overlay-dimensions", "Search dimensions")');
    expect(controller).toContain('locate("Search dimensions", &column, &row) || ++row > height');
    expect(controller).toContain("if (c >= 0x20 && c <= 0x3f) return");
    expect(controller).toContain("c == '\\\\' ? 0 : 3");
  });

  test("makes the Windows ConPTY helper close and boundedly drain every owned resource", () => {
    const controller = terminalControllerSource("win32");

    expect(controller).toContain("close_handle(&inputRead); close_handle(&outputWrite);");
    expect(controller).toContain("DeleteProcThreadAttributeList");
    expect(controller).toContain("HeapFree(GetProcessHeap(), 0, startup.lpAttributeList)");
    expect(controller).toContain("close_handle(&inputWrite)");
    expect(controller).toContain("close_handle(&outputRead)");
    expect(controller).toContain("close_handle(&process.hThread)");
    expect(controller).toContain("close_handle(&process.hProcess)");
    expect(controller).toContain("ClosePseudoConsole(*console); *console = NULL;");
    expect(controller).toContain("ULONGLONG drainStart = GetTickCount64()");
    expect(controller).toContain("PeekNamedPipe(outputRead, NULL, 0, NULL, &read, NULL)");
    expect(controller).toContain("GetTickCount64() - drainStart >= 2000");
    expect(controller).not.toContain(
      "while (ReadFile(outputRead, buffer, sizeof(buffer), &read, NULL) && read)",
    );
    const inputClose = controller.indexOf("close_handle(&inputWrite);");
    const consoleClose = controller.indexOf("close_console(&console);");
    const drainPeek = controller.indexOf("PeekNamedPipe(outputRead", consoleClose);
    expect(inputClose).toBeGreaterThanOrEqual(0);
    expect(consoleClose).toBeGreaterThan(inputClose);
    expect(drainPeek).toBeGreaterThan(consoleClose);
    expect(controller).toContain("result = 127");
    expect(controller).toContain("WriteFile(inputWrite, &ctrlc, 1, &wrote, NULL) && wrote == 1");
    expect(controller).not.toContain("kill(child, SIGINT)");
  });

  test("keeps Windows orchestration render-gated, bounded, and argv-safe", () => {
    const controller = terminalControllerSource("win32");
    expect(controller).toContain('snprintf(command, sizeof(command), "%c%s%c", 34, argv[1], 34)');
    expect(controller).toContain("if (screen && !screenAt)");
    expect(controller).toContain("GetTickCount64() - start >= 10000");
    expect(controller).toContain("argv[1]");
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
    expect(metadata.native).toMatchObject({ path: buildMetadata.nativeArtifact, digest });
    const output = await mkdtemp(join(tmpdir(), "skill-cli-plugin-extract-"));
    const pluginOutput = await mkdtemp(join(tmpdir(), "skill-cli-plugin-build-"));
    try {
      const build = Bun.spawn([
        process.execPath,
        "scripts/build.ts",
        "plugin",
        "--output-root",
        pluginOutput,
      ]);
      expect(await build.exited).toBe(0);
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
      expect(manifest.name).toBe("@skill-cli/opencode-adapter");
      expect(manifest.version).toBe(version);
      const exported = await import(
        `${pathToFileURL(join(packageRoot, "dist", "index.js")).href}?test=${Date.now()}`
      );
      expect(Object.keys(exported)).toEqual(["default"]);
      expect(typeof exported.default).toBe("function");
    } finally {
      await rm(output, { recursive: true, force: true });
      await rm(pluginOutput, { recursive: true, force: true });
    }
  });

  test("rejects foreign release output and publishes only native generated files", async () => {
    const output = await mkdtemp(join(tmpdir(), "skill-cli-native-release-"));
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
        "native",
        "--output-root",
        output,
      ]);
      expect(await built.exited).toBe(0);
      expect((await readdir(output)).sort()).toEqual([
        "SHA256SUMS",
        "release-metadata.json",
        buildMetadata.nativeArtifact,
      ]);
      const metadata = JSON.parse(await readFile(join(output, "release-metadata.json"), "utf8"));
      expect(Object.keys(metadata.artifacts)).toEqual([buildMetadata.nativeArtifact]);
      expect(await Bun.file(join(output, buildMetadata.nativeArtifact)).text()).not.toBe("stale");
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }, 30_000);

  test("runs all observable packaged actions and removes its owned root", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "skill-cli-packaged-smoke-"));
    const artifact = join(root, "dist", buildMetadata.nativeArtifact);
    try {
      await runPackagedSmoke({ artifact, outputRoot });
      expect(await lstat(outputRoot).catch(() => undefined)).toBeUndefined();
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }, 90_000);
});
