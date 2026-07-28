import { expect, test } from "bun:test";

const packageJson = JSON.parse(await Bun.file("packages/skill-cli/package.json").text()) as {
  dependencies: Record<string, string>;
};
const tsconfig = JSON.parse(await Bun.file("packages/skill-cli/tsconfig.json").text()) as {
  compilerOptions: Record<string, string>;
};
const lock = await Bun.file("bun.lock").text();
const buildSource = await Bun.file("scripts/build.ts").text();
const approvedMainSource = await Bun.file(
  "tmp/tui-implementation/sdd/baseline/bytes/packages/skill-cli/src/main.ts",
).text();

test("dependency pins OpenTUI and Solid to the approved runtime", () => {
  expect(packageJson.dependencies["@opentui/core"]).toBe("0.4.5");
  expect(packageJson.dependencies["@opentui/solid"]).toBe("0.4.5");
  expect(packageJson.dependencies["solid-js"]).toBe("1.9.12");
});

test("dependency lock has one Solid 1.9.12 resolution", () => {
  const resolutions = [
    ...lock.matchAll(/^    "(?:@opentui\/solid\/)?solid-js": \["solid-js@([^"]+)"/gm),
  ];

  expect(resolutions).toHaveLength(1);
  expect(resolutions[0]?.[1]).toBe("1.9.12");
  expect(lock).not.toContain("solid-js@1.9.14");
});

test("dependency list excludes prohibited direct runtime packages", () => {
  const prohibited = [
    "blessed",
    "chalk",
    "cli-table3",
    "drizzle-orm",
    "ink",
    "markdown-it",
    "marked",
    "node-pty",
    "ora",
    "prisma",
    "react",
    "redux",
    "remark",
    "sqlite3",
    "string-width",
    "terminal-kit",
    "typeorm",
    "xstate",
  ];

  for (const dependency of prohibited)
    expect(packageJson.dependencies).not.toHaveProperty(dependency);
});

test("JSX preserves OpenTUI Solid source", () => {
  expect(tsconfig.compilerOptions.jsx).toBe("preserve");
  expect(tsconfig.compilerOptions.jsxImportSource).toBe("@opentui/solid");
});

test("native build uses the canonical Solid standalone carrier", () => {
  expect(buildSource).toContain('import solidPlugin from "@opentui/solid/bun-plugin";');
  expect(buildSource).toContain("await Bun.build({");
  expect(buildSource).toContain('entrypoints: [join(workspace, "packages/skill-cli/src/main.ts")]');
  expect(buildSource).toContain("plugins: [solidPlugin]");
  expect(buildSource).toContain("target: currentNative.target");
  expect(buildSource).toContain("autoloadDotenv: false");
  expect(buildSource).toContain("autoloadBunfig: false");
  expect(buildSource).toContain('mkdtemp(join(tmpdir(), "skill-cli-native-build-"))');
  expect(buildSource).toContain("outdir: staging");
  expect(buildSource).toContain("result.outputs.find((item) => item.path.startsWith(staging))");
  expect(buildSource).toContain('throw new Error("Native build produced no staged executable")');
  expect(buildSource).toContain("async function prepareReleaseOutput");
  expect(buildSource).toContain("Unexpected release output files");
  expect(buildSource).toContain("Unexpected generated release files");
  expect(buildSource).toContain(
    "await rename(output.path, join(outputRoot, currentNative.artifact))",
  );
  expect(buildSource).toContain("await rm(staging, { recursive: true, force: true })");
});

test("build module preserves release, plugin packaging, and import-safe behavior", () => {
  expect(buildSource).toContain("export const buildMetadata");
  expect(buildSource).toContain("export const pluginPackageFiles");
  expect(buildSource).toContain("async function buildPlugin");
  expect(buildSource).toContain('"opencode-adapter.tgz"');
  expect(buildSource).toContain("await writeReleaseMetadata(outputRoot, [currentNative.artifact])");
  expect(buildSource).toContain('await writeReleaseMetadata(outputRoot, ["opencode-adapter.tgz"])');
  expect(buildSource).toContain("if (import.meta.main)");
});

test("approved main entry keeps the TUI import lazy", () => {
  expect(approvedMainSource).toContain('const { runTui } = await import("./tui/app")');
  expect(approvedMainSource).toContain("if (!stdinIsTTY || !stdoutIsTTY)");
  expect(approvedMainSource).not.toMatch(/^import .*\.\/tui\//m);
});
