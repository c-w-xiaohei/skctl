import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { nativeTerminal, type NativeDriver } from "./native-terminal";
import { buildEvidence, writeEvidenceReport } from "./evidence";

export const packagedChecks = [
  { name: "native-artifact" },
  { name: "local-register-discover-install" },
  { name: "collection-use-managed-agent-browse-load-read" },
  { name: "agent-run" },
  { name: "agent-download" },
  { name: "tui-start-render-input-exit" },
  { name: "cli-without-tui-and-installed-handoff" },
] as const;

export function expectedArtifactName(
  currentPlatform = process.platform,
  currentArch = process.arch,
): string {
  if (currentPlatform === "linux") return `skill-cli-linux-${currentArch}`;
  if (currentPlatform === "darwin") return `skill-cli-darwin-${currentArch}`;
  if (currentPlatform === "win32") return `skill-cli-windows-${currentArch}.exe`;
  throw new Error(`Unsupported native platform ${currentPlatform}-${currentArch}`);
}

export type SmokeOptions = {
  readonly artifact: string;
  readonly tuiArtifact: string;
  readonly outputRoot: string;
  readonly evidenceDir?: string;
  readonly manifest?: string;
  readonly buildForEvidence?: boolean;
  readonly legacyJourneys?: boolean;
};

export function parseSmokeOptions(argv: readonly string[]): SmokeOptions {
  let artifact: string | undefined;
  let tuiArtifact: string | undefined;
  let outputRoot: string | undefined;
  let evidenceDir: string | undefined;
  let manifest: string | undefined;
  let legacyJourneys = false;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--artifact") artifact = argv[++index];
    else if (value === "--tui-artifact") tuiArtifact = argv[++index];
    else if (value === "--output-root") outputRoot = argv[++index];
    else if (value === "--evidence-dir") evidenceDir = argv[++index];
    else if (value === "--manifest") manifest = argv[++index];
    else if (value === "--legacy-journeys") legacyJourneys = true;
    else throw new Error(`Unknown option ${value}`);
  }
  const buildForEvidence = !artifact && !!evidenceDir;
  if (buildForEvidence) artifact = resolve(import.meta.dir, "../../dist", expectedArtifactName());
  if (buildForEvidence)
    tuiArtifact = resolve(
      import.meta.dir,
      "../../dist",
      expectedArtifactName().replace("skill-cli-", "skill-tui-"),
    );
  if (evidenceDir && !outputRoot) outputRoot = join(evidenceDir, "fixture-runtime");
  if (!artifact || !isAbsolute(artifact)) throw new Error("--artifact must be an absolute path");
  if (!outputRoot || !isAbsolute(outputRoot))
    throw new Error("--output-root must be an absolute path");
  if (!tuiArtifact || !isAbsolute(tuiArtifact))
    throw new Error("--tui-artifact must be an absolute path");
  if (evidenceDir && !isAbsolute(evidenceDir))
    throw new Error("--evidence-dir must be an absolute path");
  if (manifest && (!evidenceDir || !isAbsolute(manifest)))
    throw new Error("--manifest requires an evidence directory and absolute path");
  if (
    evidenceDir &&
    (resolve(evidenceDir) === resolve(outputRoot) ||
      resolve(evidenceDir).startsWith(resolve(outputRoot) + "/"))
  )
    throw new Error("--evidence-dir must be outside the disposable output root");
  return {
    artifact: resolve(artifact),
    tuiArtifact: resolve(tuiArtifact),
    outputRoot: resolve(outputRoot),
    ...(legacyJourneys ? { legacyJourneys: true } : {}),
    ...(evidenceDir
      ? {
          evidenceDir: resolve(evidenceDir),
          manifest: manifest ?? join(evidenceDir, "worktree-manifest.json"),
          buildForEvidence,
        }
      : {}),
  };
}

function isolatedEnvironment(outputRoot: string): Record<string, string> {
  return {
    ...process.env,
    BUN_CONFIG_DISABLE: "1",
    SKILL_CLI_AGENT: "packaged-smoke",
    SKILL_CLI_AGENT_VERSION: "1",
    SKILL_CLI_STATE_DIR: join(outputRoot, "state"),
    XDG_CONFIG_HOME: join(outputRoot, "xdg-config"),
    XDG_STATE_HOME: join(outputRoot, "xdg-state"),
    HOME: join(outputRoot, "home"),
  } as Record<string, string>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function terminalControllerSource(target = process.platform): string {
  if (target !== "win32") throw new Error(`ConPTY controller is Windows-only: ${target}`);
  return `#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <consoleapi2.h>
#include <stdio.h>
static void close_handle(HANDLE *handle) { if (*handle && *handle != INVALID_HANDLE_VALUE) { CloseHandle(*handle); *handle = NULL; } }
static void close_console(HPCON *console) { if (*console) { ClosePseudoConsole(*console); *console = NULL; } }
int main(int argc, char **argv) {
  if (argc != 3 && argc != 4) return 2;
  SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, TRUE }; HANDLE inputRead = NULL, inputWrite = NULL, outputRead = NULL, outputWrite = NULL;
  HPCON console = NULL; STARTUPINFOEXA startup = { .StartupInfo = { .cb = sizeof(startup) } }; SIZE_T bytes = 0;
  PROCESS_INFORMATION process = { 0 }; FILE *out = NULL; int attrReady = 0, timedOut = 0, result = 3;
  if (!CreatePipe(&inputRead, &inputWrite, &sa, 0) || !CreatePipe(&outputRead, &outputWrite, &sa, 0)) goto cleanup;
  COORD size = { 120, 40 }; if (CreatePseudoConsole(size, inputRead, outputWrite, 0, &console) != S_OK) goto cleanup;
  close_handle(&inputRead); close_handle(&outputWrite);
  InitializeProcThreadAttributeList(NULL, 1, 0, &bytes); startup.lpAttributeList = HeapAlloc(GetProcessHeap(), 0, bytes);
  if (!startup.lpAttributeList || InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &bytes) != TRUE) goto cleanup;
  attrReady = 1;
  if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, console, sizeof(console), NULL, NULL)) goto cleanup;
  char command[32768]; snprintf(command, sizeof(command), "%c%s%c %s", 34, argv[1], 34, argc == 4 ? argv[3] : "");
  if (!CreateProcessA(NULL, command, NULL, NULL, FALSE, EXTENDED_STARTUPINFO_PRESENT, NULL, NULL, &startup.StartupInfo, &process)) goto cleanup;
  DeleteProcThreadAttributeList(startup.lpAttributeList); attrReady = 0; HeapFree(GetProcessHeap(), 0, startup.lpAttributeList); startup.lpAttributeList = NULL;
  out = fopen(argv[2], "wb"); if (!out) { TerminateProcess(process.hProcess, 125); WaitForSingleObject(process.hProcess, INFINITE); result = 5; goto cleanup; }
  DWORD read, exitCode = STILL_ACTIVE, wrote; char buffer[4096]; ULONGLONG start = GetTickCount64(), screenAt = 0; int screen = 0, sent = 0;
  while (exitCode == STILL_ACTIVE) {
    while (PeekNamedPipe(outputRead, NULL, 0, NULL, &read, NULL) && read && ReadFile(outputRead, buffer, sizeof(buffer), &read, NULL)) { fwrite(buffer, 1, read, out); fflush(out); for (DWORD i = 0; i + 7 < read; i++) if (!memcmp(buffer + i, "\\033[?1049h", 8)) screen = 1; }
    if (screen && !screenAt) screenAt = GetTickCount64();
    if (!sent && screenAt && GetTickCount64() - screenAt >= 100) { char ctrlc = 3; if (WriteFile(inputWrite, &ctrlc, 1, &wrote, NULL) && wrote == 1) sent = 1; else { TerminateProcess(process.hProcess, 126); WaitForSingleObject(process.hProcess, INFINITE); result = 6; goto cleanup; } }
    if (GetTickCount64() - start >= 10000) { timedOut = 1; TerminateProcess(process.hProcess, 124); WaitForSingleObject(process.hProcess, INFINITE); result = 124; break; }
    GetExitCodeProcess(process.hProcess, &exitCode); Sleep(10);
  }
  close_handle(&inputWrite);
  close_console(&console);
  ULONGLONG drainStart = GetTickCount64(); int drainDone = 0;
  while (!drainDone) {
    BOOL available = PeekNamedPipe(outputRead, NULL, 0, NULL, &read, NULL);
    if (!available) {
      DWORD error = GetLastError();
      if (error == ERROR_BROKEN_PIPE || error == ERROR_PIPE_NOT_CONNECTED) drainDone = 1;
      else { result = 127; drainDone = 1; }
    } else if (read) {
      if (!ReadFile(outputRead, buffer, sizeof(buffer), &read, NULL)) {
        DWORD error = GetLastError();
        if (error == ERROR_BROKEN_PIPE || error == ERROR_PIPE_NOT_CONNECTED) drainDone = 1;
        else { result = 127; drainDone = 1; }
      } else if (read) fwrite(buffer, 1, read, out);
    } else if (GetTickCount64() - drainStart >= 2000) { result = 127; drainDone = 1; }
    else Sleep(10);
  }
  if (!timedOut && result != 127) result = (int)exitCode;
cleanup:
  if (out) fclose(out);
  if (attrReady) DeleteProcThreadAttributeList(startup.lpAttributeList);
  if (startup.lpAttributeList) HeapFree(GetProcessHeap(), 0, startup.lpAttributeList);
  close_handle(&inputWrite); close_handle(&outputRead); close_handle(&inputRead); close_handle(&outputWrite);
  close_handle(&process.hThread); close_handle(&process.hProcess);
  close_console(&console);
  return result;
}
`;
}

type NativeMode =
  | "cold"
  | "navigation"
  | "reader"
  | "workbench"
  | "skill"
  | "collection"
  | "integration"
  | "source-global"
  | "source-project"
  | "source-local"
  | "github"
  | "mouse";

async function tui(
  artifact: string,
  outputRoot: string,
  mode: NativeMode,
  evidenceDir?: string,
  args: readonly string[] = [],
  absent = false,
  journeyName: string = mode,
) {
  if (absent && process.platform !== "win32") {
    const chunks: Uint8Array[] = [];
    const terminal = new Bun.Terminal({
      cols: 120,
      rows: 40,
      data(_terminal, bytes) {
        chunks.push(bytes.slice());
      },
    });
    const child = Bun.spawn([artifact, ...args], {
      cwd: join(outputRoot, "fixture-project"),
      env: { ...isolatedEnvironment(outputRoot), PATH: "" },
      terminal,
    });
    try {
      const status = await Promise.race([
        child.exited,
        Bun.sleep(8000).then(() => {
          throw new Error("Missing-TUI launch timed out");
        }),
      ]);
      const text = Buffer.concat(chunks).toString();
      assert(
        status === 1 &&
          text.includes("skill-tui is not installed") &&
          !text.includes("\x1b[?1049h"),
        "CLI missing-TUI behavior differs",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await child.exited;
      }
      terminal.close();
    }
    return;
  }
  if (process.platform !== "win32") {
    await nativeTerminal(
      artifact,
      join(outputRoot, "fixture-project"),
      isolatedEnvironment(outputRoot),
      evidenceDir ?? outputRoot,
      journeyName,
      (driver) => nativeJourney(driver, mode, outputRoot),
      args,
    );
    return;
  }
  const source = join(outputRoot, "pty-controller.c");
  const controller = join(outputRoot, "pty-controller.exe");
  const transcript = join(outputRoot, `tui-${mode}.typescript`);
  await writeFile(source, terminalControllerSource());
  const compile = Bun.spawn(["cl", "/nologo", source, "/Fe:" + controller], {
    cwd: outputRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [compileCode, _stdout, compileError] = await Promise.all([
    compile.exited,
    new Response(compile.stdout).text(),
    new Response(compile.stderr).text(),
  ]);
  assert(compileCode === 0, `Unable to bootstrap Windows ConPTY controller: ${compileError}`);
  const windowsArgs = args
    .map((argument) => `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`)
    .join(" ");
  const child = Bun.spawn([controller, artifact, transcript, windowsArgs], {
    cwd: join(outputRoot, "fixture-project"),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...isolatedEnvironment(outputRoot), ...(absent ? { PATH: "" } : {}) },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const rendered = `${await readFile(transcript, "utf8")}${stdout}`;
  if (absent) {
    assert(
      exitCode === 1 &&
        rendered.includes("skill-tui is not installed") &&
        !rendered.includes("\x1b[?1049h"),
      "CLI missing-TUI behavior differs",
    );
    return;
  }
  assert(exitCode === 0 || exitCode === 130, `TUI ${mode} exited ${exitCode}: ${stderr}`);
  assert(
    rendered.includes("\x1b[?1049h") && rendered.includes("\x1b[?1049l"),
    "TUI did not restore its alternate screen",
  );
}

async function nativeJourney(driver: NativeDriver, mode: NativeMode, outputRoot: string) {
  const escape = () => driver.key("\x1b");
  const clickVisible = async (label: string) => {
    const rows = driver.text().split("\n");
    const row = rows.findIndex((line) => line.includes(label));
    assert(row >= 0, `Visible UI label ${label} is absent`);
    await driver.click(label, row + 1);
  };
  const chooseScope = async (scope: "Workspace" | "Global" | "Project" | "Local") => {
    const scopeLabel = driver.text().match(/(?:Scope: )?(?:Workspace|Global|Project|Local) ▾/)?.[0];
    assert(scopeLabel, "Visible Scope trigger is absent");
    await clickVisible(scopeLabel);
    await driver.frame("scope-choices", ["Scope", "Workspace", "Global", "Project", "Local"]);
    const optionRow = driver
      .text()
      .split("\n")
      .findLastIndex((line) => line.includes(scope) && !line.includes("Scope:"));
    assert(optionRow >= 0, `Scope choice ${scope} is absent`);
    await driver.click(scope, optionRow + 1);
    await driver.frame("scope-option-selected", [
      "Scope",
      "Workspace",
      "Global",
      "Project",
      "Local",
    ]);
    await driver.key("\r");
  };
  const openPage = async (
    page: "Skills" | "Sources" | "Collections" | "Config Sources" | "Integrations",
  ) => {
    const visible = driver.text();
    const label =
      page === "Collections" && visible.includes("Cols")
        ? "Cols"
        : page === "Config Sources" && visible.includes("Configs")
          ? "Configs"
          : page === "Integrations" && visible.includes("Agents")
            ? "Agents"
            : page;
    // Native tabs include two-cell padding; match the whole caption so
    // Sources cannot resolve to the suffix of Config Sources on the same row.
    await clickVisible(`  ${label}  `);
    await driver.key("\r");
  };
  const activateAllSkills = async () => {
    await openPage("Skills");
    await clickVisible("All Skills");
    await driver.key("\r");
    await driver.frame("all-skills", ["All Skills", "Skills ·"]);
  };
  const responsive = async (name: string, required: readonly string[]) => {
    for (const [width, height] of [
      [80, 24],
      [43, 30],
      [120, 40],
    ] as const) {
      await driver.resize(width, height);
      await driver.frame(name, required);
    }
  };
  await driver.frame("startup", ["Agent access", "Scope: Workspace ▾"]);
  if (mode === "cold") {
    const path = join(outputRoot, "fixture-project", "skill-cli.jsonc");
    const before = await readFile(path, "utf8");
    await activateAllSkills();
    await driver.frame("cold-installed", ["Your Skill library is empty", "Add a Source"]);
    await chooseScope("Project");
    await driver.frame("cold-project-context", ["Project Config / Sources", "Add Source"]);
    await openPage("Collections");
    await driver.frame("cold-project-collections", [
      "Project Config / Collections",
      "fixture-collection",
    ]);
    await openPage("Sources");
    await driver.frame("cold-project", ["Project Config / Sources", "Add Source"]);
    await driver.click("Add Source");
    await driver.frame("cold-source-draft", ["Source ID", "Configured local path", "Cancel"]);
    await escape();
    await driver.frame("cold-source-cancelled", ["Project Config / Sources", "Add Source"]);
    assert((await readFile(path, "utf8")) === before, "Cold Source draft mutated Config");
    return;
  }
  if (mode === "reader" || mode === "skill") {
    await activateAllSkills();
    await driver.frame("installed-direct-reader", [
      "All Skills",
      "Skills · 1 / 1",
      "fixture",
      "Fixture",
      "SKILL.md",
    ]);
    await responsive("installed", ["All Skills", "fixture"]);
    const fixtureRow = driver
      .text()
      .split("\n")
      .findIndex((line) => /\bfixture\s+\S/.test(line.split("││", 1)[0]!));
    assert(fixtureRow >= 0, "Installed fixture row is absent");
    await driver.click("fixture", fixtureRow + 1);
    await driver.key("\r");
    await driver.frame("reader-focused", ["SKILL.md", "Fixture", "↑↓ scroll"]);
    for (const [width, height] of [
      [144, 40],
      [100, 24],
      [80, 24],
      [43, 13],
      [120, 40],
    ] as const) {
      await driver.resize(width, height);
      await driver.frame("direct-reader-resize", ["SKILL.md", "Fixture", "fixture", "↑↓ scroll"]);
    }
    if (mode === "reader") {
      const config = join(outputRoot, "fixture-project", "skill-cli.jsonc");
      const before = await readFile(config, "utf8");
      await driver.click("Details");
      await driver.frame("reader-details-tabs", [
        "Details",
        "fixture-source/fixture",
        "Description",
        "Connections",
        "Manage Skill",
      ]);
      await driver.click("Details");
      await driver.frame("reader-details-reselected", ["Details", "←→ move"]);
      await driver.key("\r");
      await driver.frame("reader-details", [
        "Details",
        "fixture-source/fixture",
        "Description",
        "↑↓ scroll",
      ]);
      await driver.click("Manage Skill");
      await driver.frame("reader-management", [
        "Manage Skill",
        "Reload",
        "Add Skill to Collection",
      ]);
      assert((await readFile(config, "utf8")) === before, "Details browsing mutated Config");
      // These later browse journeys start from the body, not the per-Skill
      // Details preference intentionally retained by semantic Back.
      await driver.click("SKILL.md");
      await driver.key("\r");
      await driver.frame("reader-body-after-details", ["Fixture", "SKILL.md", "↑↓ scroll"]);
    }
    await escape();
    await driver.frame("installed-return", ["All Skills", "fixture", "Enter read"]);
    if (mode === "reader") {
      const config = join(outputRoot, "fixture-project", "skill-cli.jsonc");
      const before = await readFile(config, "utf8");
      for (const [width, height] of [
        [100, 24],
        [80, 24],
        [43, 13],
      ] as const) {
        await driver.resize(width, height);
        await driver.frame("compact-skills-entry", ["Collections", "fixture"]);
        await clickVisible("Collections");
        await driver.frame("compact-collection-tree", ["Back to Skills", "fixture-collection"]);
        await driver.click("fixture-collection");
        await driver.key("\x1b[C");
        await driver.key("\x1b[B");
        await driver.frame("compact-collection-reference", [
          "Back to Skills",
          "child",
          "No children",
        ]);
        await escape();
        await driver.frame("compact-empty-skills", ["No matching Skills", "child"]);
        await clickVisible("Collections");
        await driver.frame("compact-reference-restored", ["Back to Skills", "child"]);
        await driver.key("\x1b[D");
        await escape();
        await driver.frame("compact-filtered-return", ["fixture", "Enter read"]);
        await driver.key("\r");
        await driver.frame("compact-filtered-read", ["Fixture", "SKILL.md", "↑↓ scroll"]);
        await escape();
        await driver.frame("compact-filtered-back", ["fixture", "Enter read"]);
      }
      await driver.resize(120, 40);
      await driver.frame("agent-entry-after-resize", ["Agent access", "All Skills", "fixture"]);
      await clickVisible("Agent access");
      await driver.key("\r");
      await driver.frame("agent-tree-restored", ["fixture-collection", "Enter expand"]);
      await driver.key("\r");
      await driver.key("\x1b[B");
      await driver.frame("agent-reference", ["Reference child", "child"]);
      await driver.key("\x1b[B");
      await driver.frame("agent-selection-reads", ["SKILL.md", "Fixture"]);
      await driver.key("\r");
      await driver.frame("agent-reader-focused", ["Fixture", "↑↓ scroll"]);
      await escape();
      await driver.frame("agent-tree-return", ["fixture", "Enter read"]);
      assert(
        (await readFile(config, "utf8")) === before,
        "Collection browsing or installed reading mutated Config",
      );
    }
    return;
  }
  if (mode === "workbench") {
    await clickVisible("Agent access");
    await driver.key("\r");
    await driver.frame("agent-access", [
      "These Collections make their Skills available",
      "fixture-collection",
    ]);
    await driver.click("fixture-collection");
    await driver.key("\r");
    await driver.frame("agent-reference-expanded", ["fixture-collection", "child", "Reference"]);
    await driver.key("\x1b[D");
    await activateAllSkills();
    await driver.frame("all-skills-return", ["All Skills", "fixture"]);
    return;
  }
  if (mode === "collection" || mode === "mouse") {
    await openPage("Collections");
    await driver.frame("collections", ["Collections", "fixture-collection"]);
    await responsive("collections", ["Collections", "fixture-collection"]);
    if (mode === "mouse") {
      await driver.click("Search Collections");
      await driver.frame("collections-search", ["Collections"]);
      await escape();
      return;
    }
    await driver.click("fixture-collection");
    await driver.key("\x1b[B\r");
    await driver.frame("entries", ["Entries", "fixture"]);
    await responsive("entries", ["Entries", "fixture"]);
    await driver.click("Relations");
    await driver.frame("relations", ["Reference child", "fixture"]);
    await responsive("relations", ["Reference child", "fixture"]);
    await driver.click("Reference child");
    await driver.key("\x1b[B\r");
    await driver.frame("reference", ["Reference child", "Open owning Config", "DANGER"]);
    await responsive("reference", ["Reference child", "Kind", "Target"]);
    await driver.click("Open owning Config");
    await driver.frame("owning-config", ["Project Config / Collections"]);
    await escape();
    await driver.frame("reference-return", ["Reference child", "Open owning Config"]);
    const path = join(outputRoot, "fixture-project", "skill-cli.jsonc");
    const before = await readFile(path, "utf8");
    await driver.click("Remove Reference");
    await driver.frame("removal-review", ["Remove Reference", "Cancel"]);
    await escape();
    await driver.frame("review-cancelled", ["Reference child", "Open owning Config"]);
    assert((await readFile(path, "utf8")) === before, "Cancelled removal mutated Config");
    await escape();
    await driver.frame("relations-return", ["Relations", "fixture"]);
    return;
  }
  if (mode === "navigation" || mode === "integration") {
    await chooseScope("Global");
    await driver.frame("global-immediate", ["Global Config / Sources"]);
    await driver.frame("context-enter-unbound", ["Global Config / Sources"]);
    await openPage("Config Sources");
    await driver.frame("config-sources", ["Global Config / Config Sources"]);
    await openPage("Collections");
    await driver.frame("config-collections", ["Global Config / Collections"]);
    await responsive("config-collections", ["Global Config / Collections"]);
    if (mode === "integration") {
      await chooseScope("Project");
      await openPage("Integrations");
      await driver.click("Managed OpenCode");
      await driver.key("\r");
      await driver.frame("integration", [
        "Managed OpenCode",
        "Available",
        "fixture-collection:fixture",
      ]);
      await driver.click("fixture-collection:fixture");
      await driver.key("\r");
      await driver.frame("catalog-entry", ["Catalog Entry", "fixture-collection:fixture"]);
      await escape();
      await driver.frame("integration-return", ["Managed OpenCode", "fixture-collection:fixture"]);
      return;
    }
    await driver.click("New Collection");
    await driver.frame("collection-draft", ["Create Collection", "Collection ID"]);
    await responsive("collection-draft", ["Create Collection", "Collection ID"]);
    await escape();
    await driver.frame("draft-cancelled", ["Global Config / Collections"]);
    for (const [width, height] of [
      [43, 12],
      [42, 30],
    ] as const) {
      await driver.resize(width, height);
      await driver.frame("resize-gate", ["Resize"]);
      assert(
        !driver.text().includes("Global Config / Collections"),
        "Resize gate kept a background page mounted",
      );
    }
    await driver.resize(120, 40);
    await driver.frame("resize-recovered", ["Global Config / Collections"]);
    return;
  }
  const level = mode === "github" ? "global" : mode.slice(7);
  await chooseScope((level[0]!.toUpperCase() + level.slice(1)) as "Global" | "Project" | "Local");
  await openPage("Sources");
  await driver.frame("source-config", [
    `${level[0]!.toUpperCase() + level.slice(1)} Config / Sources`,
  ]);
  await driver.key("\x10");
  await driver.frame("source-palette", ["Command Palette", "Add Source"]);
  await driver.click("Add Source");
  await driver.frame("source-form", ["Add Source"]);
  if (mode === "github") {
    await driver.key("\x1b[B");
    await driver.key("\tgithub-cancel\towner\trepository");
    await driver.frame("github-draft", ["github-cancel", "owner", "repository"]);
  } else {
    await driver.key(`\tsource-${level}\t${join(outputRoot, "fixture-source-root")}\tfixture`);
    await driver.frame("local-draft", [`source-${level}`, "fixture-source-root"]);
  }
  await escape();
  await driver.frame("source-cancelled", ["Config / Sources"]);
}

export async function runPackagedSmoke(options: SmokeOptions): Promise<void> {
  let commandIndex = 0;
  const before = await lstat(options.outputRoot).catch(() => undefined);
  if (before !== undefined)
    assert(
      before.isDirectory() && (await readdir(options.outputRoot)).length === 0,
      "--output-root must be fresh and empty",
    );
  else await mkdir(options.outputRoot, { recursive: true });
  const project = join(options.outputRoot, "fixture-project");
  const install = join(options.outputRoot, "installed");
  await mkdir(install);
  const cli = join(install, process.platform === "win32" ? "skill-cli.exe" : "skill-cli");
  await copyFile(options.artifact, cli);
  await chmod(cli, 0o755);
  const command = async (args: readonly string[]) => {
    const argv = [cli, "--project", project, ...args];
    const child = Bun.spawn(argv, {
      cwd: project,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: isolatedEnvironment(options.outputRoot),
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (options.evidenceDir) {
      await mkdir(join(options.evidenceDir, "commands"), { recursive: true });
      await writeFile(
        join(
          options.evidenceDir,
          "commands",
          `${++commandIndex}-${args.slice(0, 3).join("-")}.txt`,
        ),
        `${JSON.stringify(argv)}\nexitCode: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    return { exitCode, stdout, stderr };
  };
  const success = async (args: readonly string[]) => {
    const result = await command(args);
    assert(
      result.exitCode === 0 && result.stderr.length === 0,
      `${args.join(" ")} failed (${result.exitCode})\n${result.stdout}${result.stderr}`,
    );
    return result;
  };
  const check = async (index: number, run: () => Promise<void>) => {
    await run();
    process.stdout.write(`Packaged check ${packagedChecks[index]!.name}: PASS\n`);
  };
  try {
    await check(0, async () => {
      const artifact = await stat(options.artifact);
      assert(
        artifact.isFile() && basename(options.artifact) === expectedArtifactName(),
        "Artifact target name or type differs",
      );
      if (process.platform !== "win32")
        assert((artifact.mode & 0o111) !== 0, "Artifact is not executable");
      assert((await readFile(options.artifact)).length > 0, "Artifact is empty");
      assert(
        (await stat(options.tuiArtifact)).isFile() &&
          (await readFile(options.tuiArtifact)).length > 0,
        "TUI artifact is absent or empty",
      );
    });
    const sourceRoot = join(options.outputRoot, "fixture-source-root");
    const skill = join(sourceRoot, "fixture");
    const skillBytes = "---\nname: fixture\ndescription: Fixture skill\n---\n# Fixture\n";
    const marker = "packaged-run-marker";
    await mkdir(join(skill, "assets"), { recursive: true });
    await mkdir(project);
    await writeFile(
      join(project, "skill-cli.jsonc"),
      '{"collections":{"fixture-collection":{"members":{}}}}\n',
    );
    await writeFile(join(skill, "SKILL.md"), skillBytes);
    await writeFile(
      join(skill, "run.ts"),
      `console.log(process.cwd()); console.log("${marker}"); process.exit(7);\n`,
    );
    const payload = new Uint8Array([0, 255, 1, 2]);
    await writeFile(join(skill, "assets", "payload.bin"), payload);
    await success([]);
    const explicitNonTTY = await command(["tui"]);
    assert(
      explicitNonTTY.exitCode === 1 && explicitNonTTY.stderr.includes("interactive"),
      "Explicit UI must require a terminal",
    );
    await tui(
      cli,
      options.outputRoot,
      "cold",
      options.evidenceDir,
      [],
      true,
      "cold-cli-default-missing",
    );
    await tui(
      cli,
      options.outputRoot,
      "cold",
      options.evidenceDir,
      ["tui"],
      true,
      "cold-cli-tui-missing",
    );
    const installedTui = join(
      install,
      process.platform === "win32" ? "skill-tui.exe" : "skill-tui",
    );
    await copyFile(options.tuiArtifact, installedTui);
    await chmod(installedTui, 0o755);
    const help = Bun.spawn([installedTui, "--help"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [helpCode, helpText] = await Promise.all([help.exited, new Response(help.stdout).text()]);
    assert(
      helpCode === 0 && helpText.includes("Usage: skill-tui"),
      "Standalone help failed without a terminal",
    );
    await tui(
      installedTui,
      options.outputRoot,
      "cold",
      options.evidenceDir,
      ["--project", project],
      false,
      "cold-standalone-project",
    );
    await check(6, async () => {
      await tui(
        cli,
        options.outputRoot,
        "cold",
        options.evidenceDir,
        [],
        false,
        "cold-cli-default",
      );
      await tui(
        cli,
        options.outputRoot,
        "cold",
        options.evidenceDir,
        ["tui"],
        false,
        "cold-cli-tui",
      );
      await tui(
        cli,
        options.outputRoot,
        "cold",
        options.evidenceDir,
        ["--project", project, "tui"],
        false,
        "cold-cli-project-command-order",
      );
      await tui(
        cli,
        options.outputRoot,
        "cold",
        options.evidenceDir,
        ["tui", "--project", project],
        false,
        "cold-cli-command-project-order",
      );
      if (process.platform !== "win32")
        await nativeTerminal(
          cli,
          project,
          isolatedEnvironment(options.outputRoot),
          options.evidenceDir ?? options.outputRoot,
          "launcher-sigterm",
          async (driver) => {
            await driver.frame("startup", ["Agent access", "Scope: Workspace ▾"]);
          },
          ["tui"],
          "SIGTERM",
        );
    });
    await check(1, async () => {
      for (const args of [
        ["source", "register", "local", "fixture-source", sourceRoot, "--level", "project"],
        ["source", "discover", "fixture-source"],
        ["install", "fixture-source", "fixture"],
      ])
        await success(args);
    });
    await check(2, async () => {
      for (const args of [
        [
          "collection",
          "member",
          "add",
          "fixture-collection",
          "fixture",
          "fixture-source",
          "fixture",
        ],
        ["collection", "create", "child", "--scope", "project"],
        [
          "collection",
          "reference",
          "add",
          "fixture-collection",
          "child",
          "child",
          "Reference child",
          "--scope",
          "project",
        ],
        ["use", "set", "fixture-collection"],
        ["managed", "set"],
      ])
        await success(args);
      const root = await success(["agent", "browse"]);
      assert(
        root.stdout.includes('<managed_skill_catalog scope="root">') &&
          root.stdout.includes("<id>fixture-collection</id>"),
        "Agent root browse differs",
      );
      const collection = await success(["agent", "browse", "fixture-collection"]);
      assert(
        collection.stdout.includes(
          '<managed_skill_catalog scope="collection" id="fixture-collection">',
        ) && collection.stdout.includes("<selector>fixture-collection:fixture</selector>"),
        "Agent Collection browse differs",
      );
      const load = await success(["agent", "load", "fixture-collection:fixture"]);
      assert(load.stdout === skillBytes, "Agent load bytes differ");
      const read = await success(["agent", "read", "fixture-collection:fixture", "run.ts"]);
      assert(read.stdout.includes(marker), "Agent read bytes differ");
    });
    await check(3, async () => {
      const run = await command([
        "agent",
        "run",
        "fixture-collection:fixture",
        "--",
        process.execPath,
        "run.ts",
        marker,
      ]);
      const runRoot = relative(
        join(options.outputRoot, "state", "runs"),
        run.stdout.split("\n")[0]!.trim(),
      );
      assert(
        /^[^/\\]+[/\\]root$/.test(runRoot) &&
          run.stdout.includes(marker) &&
          run.exitCode === 7 &&
          !run.stdout.includes('"exitCode"'),
        "Agent run did not preserve its owned cwd, marker or child status",
      );
    });
    await check(4, async () => {
      const output = join(options.outputRoot, "download.bin");
      const args = [
        "agent",
        "download",
        "fixture-collection:fixture",
        "assets/payload.bin",
        "--output",
      ];
      const downloaded = await success([...args, output]);
      assert(
        JSON.parse(downloaded.stdout).output === output &&
          Buffer.compare(await readFile(output), payload) === 0,
        "Agent download bytes differ",
      );
      const hardLink = join(options.outputRoot, "download-hard-link.bin");
      await link(output, hardLink);
      const outputLink = join(options.outputRoot, "download-link.bin");
      await symlink(hardLink, outputLink);
      const rejected = await command([...args, outputLink]);
      assert(
        rejected.exitCode === 1 && (await lstat(outputLink)).isSymbolicLink(),
        "Download replaced an existing symlink",
      );
      const replacement = new Uint8Array([3, 4, 5, 6]);
      await writeFile(join(skill, "assets", "payload.bin"), replacement);
      const handle = await open(output, "r");
      try {
        const forced = await success([...args, output, "--force"]);
        assert(
          JSON.parse(forced.stdout).output === output,
          "Forced download failed with an open destination",
        );
      } finally {
        await handle.close();
      }
      assert(
        Buffer.compare(await readFile(output), replacement) === 0,
        "Forced download did not publish replacement bytes",
      );
      assert(
        Buffer.compare(await readFile(hardLink), payload) === 0,
        "Forced download did not atomically replace the hard-linked destination",
      );
      await chmod(output, 0o600);
    });
    await check(5, async () => {
      const modes: readonly NativeMode[] =
        options.legacyJourneys && process.platform !== "win32"
          ? [
              "reader",
              "workbench",
              "skill",
              "collection",
              "integration",
              "navigation",
              "source-global",
              "source-project",
              "source-local",
              "github",
              "mouse",
            ]
          : ["reader"];
      if (!options.legacyJourneys)
        process.stdout.write(
          "Packaged scope: direct selected-Skill Reader and resize at 144x40, 100x24, 80x24 and 43x13; compact Collection hierarchy/filter/empty/return at 100/80/43 columns; Agent Tree Reference/direct-reading/return, unchanged Config and terminal restoration. Other legacy journeys are excluded (opt in with --legacy-journeys). Human usability remains pending.\n",
        );
      for (const mode of modes)
        await tui(installedTui, options.outputRoot, mode, options.evidenceDir, [
          "--project",
          project,
        ]);
    });
  } finally {
    await rm(options.outputRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const options = parseSmokeOptions(process.argv.slice(2));
  if (options.buildForEvidence && options.evidenceDir && options.manifest) {
    const built = await buildEvidence(
      options.evidenceDir,
      options.manifest,
      expectedArtifactName(),
    );
    let failure: unknown;
    try {
      await runPackagedSmoke({
        ...options,
        artifact: built.artifact,
        tuiArtifact: built.tuiArtifact,
      });
    } catch (error) {
      failure = error;
    }
    await writeEvidenceReport(options.evidenceDir, built.binarySha256, failure);
    if (failure) throw failure;
  } else await runPackagedSmoke(options);
}
