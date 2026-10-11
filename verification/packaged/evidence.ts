import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "../..");
const digest = (bytes: Uint8Array | string) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

async function command(argv: readonly string[]) {
  const child = Bun.spawn([...argv], { cwd: workspace, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${argv.join(" ")} exited ${exitCode}\n${stderr}`);
  return stdout;
}

async function inputs() {
  const paths = (
    await command(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  )
    .split("\0")
    .filter(
      (path) =>
        path &&
        (path.startsWith("packages/skill-cli/src/") ||
          path.startsWith("packages/skill-core/src/") ||
          path.startsWith("packages/skill-tui/src/") ||
          path.startsWith("packages/opencode-adapter/src/") ||
          path === "scripts/build.ts" ||
          /^(bun\.lockb?|package\.json)$/.test(path) ||
          /^packages\/[^/]+\/package\.json$/.test(path)),
    )
    .sort();
  return Promise.all(
    paths.map(async (path) => ({ path, sha256: digest(await readFile(join(workspace, path))) })),
  );
}

/** Build correspondence is established from the exact dirty input bytes, not HEAD alone. */
export async function buildEvidence(
  evidenceDir: string,
  manifestPath: string,
  artifactName: string,
) {
  const entries = await readdir(evidenceDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  if (entries.length) throw new Error("--evidence-dir must be fresh and empty");
  await mkdir(join(evidenceDir, "commands"), { recursive: true });
  const before = await inputs();
  const runnerInputs = await Promise.all(
    [
      "verification/packaged/smoke.ts",
      "verification/packaged/native-terminal.ts",
      "verification/packaged/evidence.ts",
    ].map(async (path) => ({ path, sha256: digest(await readFile(join(workspace, path))) })),
  );
  const head = (await command(["git", "rev-parse", "HEAD"])).trim();
  const status = await command(["git", "status", "--porcelain=v1", "--untracked-files=all"]);
  const diff = await command(["git", "diff", "--no-ext-diff", "--binary", "HEAD"]);
  const untracked = (
    await command(["git", "ls-files", "--others", "--exclude-standard", "-z"])
  ).split("\0");
  const argv = [process.execPath, "scripts/build.ts", "native"];
  const startedAt = new Date().toISOString();
  await command(argv);
  const after = await inputs();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Build inputs changed during native build");
  const artifact = join(evidenceDir, "binary", artifactName);
  await mkdir(join(evidenceDir, "binary"));
  await copyFile(join(workspace, "dist", artifactName), artifact);
  const tuiName = artifactName.replace("skill-cli-", "skill-tui-");
  const tuiArtifact = join(evidenceDir, "binary", tuiName);
  await copyFile(join(workspace, "dist", tuiName), tuiArtifact);
  const binarySha256 = digest(await readFile(artifact));
  const tuiSha256 = digest(await readFile(tuiArtifact));
  const manifest = {
    head,
    status,
    trackedDiffSha256: digest(diff),
    buildInputs: before,
    runnerInputs,
    untrackedBuildInputs: before.filter((input) => untracked.includes(input.path)),
    buildCommand: argv,
    bunVersion: Bun.version,
    startedAt,
    builtAt: new Date().toISOString(),
    artifact,
    binarySha256,
    tuiArtifact,
    tuiSha256,
    unchangedDuringBuild: true,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(
    join(evidenceDir, "commands", "build-native.txt"),
    `${argv.join(" ")}\nexitCode: 0\nbinarySha256: ${binarySha256}\n`,
  );
  return { artifact, binarySha256, tuiArtifact, tuiSha256 };
}

export async function writeEvidenceReport(root: string, binarySha256: string, failure?: unknown) {
  const checkpoints: { journey: string; frame: string; required: string[] }[] = [];
  const transcripts = await readdir(join(root, "transcripts")).catch(() => []);
  for (const path of transcripts.filter((path) => path.endsWith(".ndjson"))) {
    const events = (await readFile(join(root, "transcripts", path), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    for (const event of events)
      if (event.type === "checkpoint")
        checkpoints.push({
          journey: path.replace(/\.ndjson$/, ""),
          frame: event.frame,
          required: event.required,
        });
  }
  await writeFile(
    join(root, "report.md"),
    `# Packaged native evidence\n\nStatus: ${failure ? "FAILED" : "automated journeys passed"}\n\nBinary SHA-256: \`${binarySha256}\`\n\n${failure ? String(failure) + "\n\n" : ""}## Checkpoints\n\n${checkpoints.map((checkpoint) => `- ${checkpoint.journey}: \`${checkpoint.frame}\` — ${checkpoint.required.join("; ")}`).join("\n")}\n\n## Evidence boundaries\n\nThese frames come from the compiled executable in a real PTY. Each checkpoint waits for its required visible state; transcripts record keys, clicks, resize and process exit. Cancellation checks compare Config bytes. They do not constitute human visual approval or prove every command-record/physical-focus invariant; the renderer integration tests provide the complementary keyboard and ownership proofs.\n`,
  );
  await mkdir(join(root, "attestations"), { recursive: true });
  await writeFile(
    join(root, "attestations", "two-second-orientation.md"),
    `# Two-second orientation\n\nStatus: PENDING HUMAN REVIEW. No human attestation is fabricated.\n\nFor the saved Skills, Inspector, Reader, Collection, Relationship, Config and resize frames, identify Context, Section, Object, Surface, focus zone, active pane and Esc destination within two seconds. Record reviewer, date, frame and result below.\n`,
  );
}
