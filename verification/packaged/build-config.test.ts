import { expect, test } from "bun:test";

const manifest = async (name: string) =>
  JSON.parse(await Bun.file(`packages/${name}/package.json`).text()) as {
    name: string;
    private: boolean;
    exports?: Record<string, string>;
    dependencies: Record<string, string>;
  };
const core = await manifest("skill-core");
const cli = await manifest("skctl");
const tui = await manifest("sktui");
const lock = await Bun.file("bun.lock").text();
const buildSource = await Bun.file("scripts/build.ts").text();

test("workspace packages own their actual runtime dependencies", () => {
  expect(core.name).toBe("@skctl/core");
  expect(cli.name).toBe("@skctl/cli");
  expect(tui.name).toBe("@skctl/tui");
  for (const pkg of [core, cli, tui]) expect(pkg.private).toBe(true);
  expect(core.exports).toEqual({ ".": "./src/index.ts" });
  expect(Object.keys(cli.dependencies).sort()).toEqual(["@skctl/core", "commander"]);
  expect(cli.dependencies["@skctl/core"]).toBe("workspace:*");
  expect(tui.dependencies["@skctl/core"]).toBe("workspace:*");
  for (const dependency of ["commander", "solid-js", "@opentui/core", "@opentui/solid"])
    expect(core.dependencies).not.toHaveProperty(dependency);
  expect(tui.dependencies["@opentui/core"]).toBe("0.5.14");
  expect(tui.dependencies["@opentui/solid"]).toBe("0.5.14");
  expect(tui.dependencies["solid-js"]).toBe("1.9.12");
});

test("dependency lock has one Solid 1.9.12 resolution", () => {
  const resolutions = [
    ...lock.matchAll(/^    "(?:@opentui\/solid\/)?solid-js": \["solid-js@([^"]+)"/gm),
  ];
  expect(resolutions).toHaveLength(1);
  expect(resolutions[0]?.[1]).toBe("1.9.12");
  expect(lock).not.toContain("solid-js@1.9.14");
});

test("only TUI owns JSX and UI preloads", async () => {
  for (const name of ["skill-core", "skctl", "sktui"]) {
    const config = JSON.parse(await Bun.file(`packages/${name}/tsconfig.json`).text());
    if (name === "sktui") {
      expect(config.compilerOptions.jsx).toBe("preserve");
      expect(config.compilerOptions.jsxImportSource).toBe("@opentui/solid");
    } else {
      expect(config.compilerOptions).not.toHaveProperty("jsx");
      expect(config.compilerOptions).not.toHaveProperty("jsxImportSource");
    }
  }
  expect(await Bun.file("bunfig.toml").text()).not.toContain("preload");
  const root = JSON.parse(await Bun.file("package.json").text());
  expect(root.scripts["test:tui"]).toContain("--preload @opentui/solid/preload");
  expect(root.scripts["test:tui"]).toContain("packages/sktui/test/test-renderer-preload.ts");
});

test("CLI source no longer imports the TUI graph", async () => {
  const main = await Bun.file("packages/skctl/src/main.ts").text();
  expect(main).not.toContain("sktui/src");
  expect(main).not.toContain("./tui/");
  expect(main).not.toContain("@opentui/");
});

test("build preserves staged native output and import-safe plugin packaging", () => {
  for (const source of [
    "autoloadDotenv: false",
    "autoloadBunfig: false",
    "async function prepareReleaseOutput",
    "Unexpected release output files",
    "Unexpected generated release files",
    "export const buildMetadata",
    "export const pluginPackageFiles",
    "async function buildPlugin",
    '"opencode-adapter.tgz"',
    "if (import.meta.main)",
  ])
    expect(buildSource).toContain(source);
});
