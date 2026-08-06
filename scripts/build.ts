import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import solidPlugin from "@opentui/solid/bun-plugin";

const workspace = resolve(import.meta.dir, "..");
const appManifest = join(workspace, "packages/skill-cli/package.json");
const adapterManifest = join(workspace, "packages/opencode-adapter/package.json");

const nativeTargets: Record<string, { artifact: string; target: string }> = {
  "linux-x64": { artifact: "skill-cli-linux-x64", target: "bun-linux-x64-modern" },
  "darwin-arm64": { artifact: "skill-cli-darwin-arm64", target: "bun-darwin-arm64-modern" },
  "win32-x64": { artifact: "skill-cli-windows-x64.exe", target: "bun-windows-x64-modern" },
};
const currentNative = nativeTargets[`${platform()}-${arch()}`];
if (!currentNative) throw new Error(`Unsupported native host ${platform()}-${arch()}`);

export const buildMetadata = {
  nativeArtifact: currentNative.artifact,
  nativeTarget: currentNative.target,
  pluginEntry: "opencode-adapter.js",
  pluginDeclaration: "dist/index.d.ts",
} as const;
export const pluginPackageFiles = [
  "dist/index.d.ts",
  "dist/index.js",
  "dist/process.d.ts",
  "package.json",
] as const;

type BuildOptions = { readonly kind: "native" | "plugin"; readonly outputRoot: string };

function parseArgs(argv: readonly string[]): BuildOptions {
  const kind = argv[0];
  if (kind !== "native" && kind !== "plugin")
    throw new Error("Usage: build.ts <native|plugin> [--output-root <absolute-path>]");
  let outputRoot = join(workspace, "dist");
  for (let index = 1; index < argv.length; index++) {
    if (argv[index] !== "--output-root") throw new Error(`Unknown option ${argv[index]}`);
    outputRoot = argv[++index] ?? "";
  }
  if (!isAbsolute(outputRoot)) throw new Error("--output-root must be an absolute path");
  return { kind, outputRoot: resolve(outputRoot) };
}

async function run(
  argv: readonly string[],
  cwd = workspace,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn([...argv], {
    cwd,
    env: { ...process.env, BUN_CONFIG_DISABLE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${argv.join(" ")} failed (${exitCode})\n${stdout}${stderr}`);
  return { stdout, stderr };
}

async function sha256(path: string): Promise<string> {
  const bytes = await readFile(path);
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function regularFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await regularFiles(root, name)));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}

const releaseMetadataFiles = ["SHA256SUMS", "release-metadata.json"] as const;
const generatedReleaseFiles = [
  ...Object.values(nativeTargets).map((target) => target.artifact),
  "opencode-adapter.tgz",
  "opencode-adapter.js",
  ...releaseMetadataFiles,
] as const;

async function prepareReleaseOutput(outputRoot: string): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const files = await regularFiles(outputRoot);
  const known = new Set<string>(generatedReleaseFiles);
  const foreign = files.filter((file) => !known.has(file));
  if (foreign.length) throw new Error(`Unexpected release output files: ${foreign.join(", ")}`);
}

async function writeReleaseMetadata(outputRoot: string): Promise<void> {
  const actual = (await regularFiles(outputRoot)).filter(
    (file) => !releaseMetadataFiles.includes(file as (typeof releaseMetadataFiles)[number]),
  );
  const known = new Set<string>(generatedReleaseFiles);
  const foreign = actual.filter((file) => !known.has(file));
  if (foreign.length) throw new Error(`Unexpected generated release files: ${foreign.join(", ")}`);
  const sums = await Promise.all(
    actual.map(async (file) => `${await sha256(join(outputRoot, file))}  ${file}`),
  );
  await writeFile(join(outputRoot, "SHA256SUMS"), `${sums.join("\n")}\n`);
  const app = JSON.parse(await readFile(appManifest, "utf8")) as { version: string };
  const nativePath = join(outputRoot, currentNative.artifact);
  const native = (await readFile(nativePath).catch(() => undefined))
    ? { ...currentNative, path: currentNative.artifact, digest: await sha256(nativePath) }
    : undefined;
  await writeFile(
    join(outputRoot, "release-metadata.json"),
    `${JSON.stringify(
      {
        version: app.version,
        host: `${platform()}-${arch()}`,
        native,
        artifacts: Object.fromEntries(
          await Promise.all(
            actual.map(async (file) => [file, await sha256(join(outputRoot, file))]),
          ),
        ),
      },
      null,
      2,
    )}\n`,
  );
}

async function buildNative(outputRoot: string): Promise<void> {
  await prepareReleaseOutput(outputRoot);
  const staging = await mkdtemp(join(tmpdir(), "skill-cli-native-build-"));
  try {
    const result = await Bun.build({
      entrypoints: [join(workspace, "packages/skill-cli/src/main.ts")],
      plugins: [solidPlugin],
      compile: {
        target: currentNative.target,
        autoloadDotenv: false,
        autoloadBunfig: false,
      },
      outdir: staging,
    });
    if (!result.success) throw new AggregateError(result.logs, "Native build failed");
    const output = result.outputs.find((item) => item.path.startsWith(staging));
    if (!output) throw new Error("Native build produced no staged executable");
    await rename(output.path, join(outputRoot, currentNative.artifact));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await writeReleaseMetadata(outputRoot);
}

async function buildPlugin(outputRoot: string): Promise<void> {
  await prepareReleaseOutput(outputRoot);
  const staging = await mkdtemp(join(tmpdir(), "skill-cli-plugin-pack-"));
  try {
    const packageRoot = join(staging, "package");
    const dist = join(packageRoot, "dist");
    await mkdir(dist, { recursive: true });
    await run([
      process.execPath,
      "build",
      join(workspace, "packages/opencode-adapter/src/index.ts"),
      "--target=bun",
      "--format=esm",
      "--packages=bundle",
      `--outfile=${join(dist, "index.js")}`,
    ]);
    await run([
      process.execPath,
      "x",
      "tsc",
      "--declaration",
      "--emitDeclarationOnly",
      "--noEmit",
      "false",
      "--allowImportingTsExtensions",
      "true",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--target",
      "ES2022",
      "--strict",
      "true",
      "--skipLibCheck",
      "true",
      "--types",
      "bun",
      "--outDir",
      dist,
      join(workspace, "packages/opencode-adapter/src/index.ts"),
    ]);
    await writeFile(join(packageRoot, "package.json"), await readFile(adapterManifest));
    const exported = await import(
      `${pathToFileURL(join(dist, "index.js")).href}?build=${Date.now()}`
    );
    if (Object.keys(exported).length !== 1 || typeof exported.default !== "function")
      throw new Error("Plugin build must export only a default function");
    const files = await regularFiles(packageRoot);
    if (JSON.stringify(files) !== JSON.stringify(pluginPackageFiles))
      throw new Error(`Unexpected plugin package contents: ${files.join(", ")}`);
    const tarball = join(outputRoot, "opencode-adapter.tgz");
    await copyFile(join(dist, "index.js"), join(outputRoot, "opencode-adapter.js"));
    await run(["tar", "-C", staging, "-czf", tarball, "package"]);
    const tarContents = (await run(["tar", "-tzf", tarball])).stdout;
    const expected = pluginPackageFiles.map((file) => `package/${file}`).sort();
    if (
      JSON.stringify(
        tarContents
          .trim()
          .split("\n")
          .filter((entry) => !entry.endsWith("/"))
          .sort(),
      ) !== JSON.stringify(expected)
    )
      throw new Error("Plugin tarball content validation failed");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await writeReleaseMetadata(outputRoot);
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (options.kind === "native") await buildNative(options.outputRoot);
  else await buildPlugin(options.outputRoot);
}
