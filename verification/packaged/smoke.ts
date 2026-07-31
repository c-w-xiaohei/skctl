import {
  chmod,
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
import { basename, isAbsolute, join, resolve } from "node:path";

export const packagedChecks = [
  { name: "native-artifact" },
  { name: "local-register-discover-install" },
  { name: "collection-use-managed-agent-browse-load-read" },
  { name: "agent-run" },
  { name: "agent-download" },
  { name: "tui-start-render-input-exit" },
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

export type SmokeOptions = { readonly artifact: string; readonly outputRoot: string };
export function parseSmokeOptions(argv: readonly string[]): SmokeOptions {
  let artifact: string | undefined;
  let outputRoot: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--artifact") artifact = argv[++index];
    else if (value === "--output-root") outputRoot = argv[++index];
    else throw new Error(`Unknown option ${value}`);
  }
  if (!artifact || !isAbsolute(artifact)) throw new Error("--artifact must be an absolute path");
  if (!outputRoot || !isAbsolute(outputRoot))
    throw new Error("--output-root must be an absolute path");
  return { artifact: resolve(artifact), outputRoot: resolve(outputRoot) };
}

type Result = {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
};
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
async function invoke(
  argv: readonly string[],
  cwd: string,
  outputRoot: string,
  stdin?: Uint8Array,
): Promise<Result> {
  const child = Bun.spawn([...argv], {
    cwd,
    stdin: stdin === undefined ? "ignore" : new Blob([Buffer.from(stdin)]),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...isolatedEnvironment(outputRoot),
    },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).bytes(),
    new Response(child.stderr).bytes(),
  ]);
  return { exitCode, stdout, stderr };
}
function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
function finalJson(bytes: Uint8Array): Record<string, unknown> {
  const line = text(bytes).trimEnd().split("\n").at(-1);
  if (!line) throw new Error("Missing terminal JSON protocol result");
  return JSON.parse(line) as Record<string, unknown>;
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function runPackagedCheck(name: string, operation: () => Promise<void>): Promise<void> {
  await operation();
  process.stdout.write(`Packaged check ${name}: PASS\n`);
}

export function terminalControllerSource(target = process.platform): string {
  if (target === "linux" || target === "darwin")
    return `#include <fcntl.h>
#include <pty.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
static char screen[40][121], mouse_before[40][121]; static int width = 120, height = 40, x, y, esc, params[8], count, value;
static void clear_screen(void) { for (int row = 0; row < 40; row++) memset(screen[row], ' ', 120); x = y = 0; }
static int parameter(int fallback) { return count ? params[0] : fallback; }
static void put_byte(unsigned char c) {
  if (esc == 1) { esc = c == '[' ? 2 : c == ']' ? 3 : (c >= 0x20 && c <= 0x2f) ? 5 : 0; count = value = 0; return; }
  if (esc == 3) { if (c == 7) esc = 0; else if (c == 27) esc = 4; return; }
  if (esc == 4) { esc = c == '\\\\' ? 0 : 3; return; }
  if (esc == 5) { esc = 0; return; }
  if (esc == 2) {
    if (c >= '0' && c <= '9') { value = value * 10 + c - '0'; return; }
    if (c == ';' || c == ':') { if (count < 8) params[count++] = value; value = 0; return; }
    if (c >= 0x20 && c <= 0x3f) return;
    if (c < 0x40 || c > 0x7e) return;
    if (count < 8) params[count++] = value;
    if (c == 'H' || c == 'f') { y = (params[0] ?: 1) - 1; x = (count > 1 ? params[1] : 1) - 1; }
    else if (c == 'A') y -= parameter(1); else if (c == 'B') y += parameter(1);
    else if (c == 'C') x += parameter(1); else if (c == 'D') x -= parameter(1);
    else if (c == 'J') clear_screen(); else if (c == 'K') while (x < width) screen[y][x++] = ' ';
    else if (c == 'h' || c == 'l') { if (count >= 1 && params[0] == 1049) clear_screen(); }
    if (x < 0) x = 0; if (y < 0) y = 0; if (x >= width) x = width - 1; if (y >= height) y = height - 1;
    esc = 0; return;
  }
  if (c == 27) { esc = 1; return; } if (c == '\\r') { x = 0; return; }
  if (c == '\\n') { if (++y >= height) y = height - 1; return; }
  if (c >= 32 && c < 127) { if (x < width && y < height) screen[y][x] = c; if (++x >= width) { x = 0; if (++y >= height) y = height - 1; } }
}
static int has(const char *needle) { char flat[40 * 121 + 1], *at = flat; for (int row = 0; row < height; row++) { memcpy(at, screen[row], width); at += width; *at++ = '\\n'; } *at = 0; return strstr(flat, needle) != NULL; }
static int locate(const char *needle, int *column, int *row) { size_t length = strlen(needle); for (int y = 0; y < height; y++) for (int x = 0; x + (int)length <= width; x++) if (!memcmp(screen[y] + x, needle, length)) { *column = x + 1; *row = y + 1; return 1; } return 0; }
static int checkpoint(const char *label, const char *needle) { if (has(needle)) return 1; fprintf(stderr, "PTY checkpoint %s missing %s\\n", label, needle); for (int row = 0; row < height; row++) fprintf(stderr, "%.*s\\n", width, screen[row]); return 0; }
static void print_file(const char *label, const char *path) { char bytes[16384]; FILE *file = fopen(path, "rb"); if (!file) { fprintf(stderr, "PTY %s: missing %s\\n", label, path); return; } size_t count = fread(bytes, 1, sizeof bytes - 1, file); fclose(file); bytes[count] = 0; fprintf(stderr, "PTY %s %s:\\n%s\\n", label, path, bytes); }
static int file_has(const char *path, const char *needle) { char bytes[16384]; FILE *file = fopen(path, "rb"); if (!file) return 0; size_t count = fread(bytes, 1, sizeof bytes - 1, file); fclose(file); bytes[count] = 0; return strstr(bytes, needle) != NULL; }
static int config_has(const char *project, const char *needle) { char path[4096]; snprintf(path, sizeof path, "%s/skill-cli.jsonc", project); return file_has(path, needle); }
static int level_has(const char *project, const char *level, const char *needle) { char path[4096]; if (!strcmp(level, "global")) { const char *slash = strrchr(project, '/'); if (!slash) return 0; snprintf(path, sizeof path, "%.*s/xdg-config/skill-cli/config.jsonc", (int)(slash - project), project); } else snprintf(path, sizeof path, "%s/%s", project, !strcmp(level, "project") ? "skill-cli.jsonc" : "skill-cli.local.jsonc"); return file_has(path, needle); }
static void send_bytes(int master, const char *bytes) { write(master, bytes, strlen(bytes)); }
static void resize_pty(int master, pid_t child, int columns, int rows) { struct winsize size = { .ws_col = columns, .ws_row = rows }; ioctl(master, TIOCSWINSZ, &size); kill(-child, SIGWINCH); width = columns; height = rows; if (width > 120) width = 120; if (height > 40) height = 40; clear_screen(); }
int main(int argc, char **argv) {
  if (argc != 5) return 2;
  int master; struct winsize initial = { .ws_col = 120, .ws_row = 40 }; pid_t child = forkpty(&master, NULL, NULL, &initial);
  if (child == 0) { setpgid(0, 0); tcsetpgrp(STDIN_FILENO, getpgrp()); if (chdir(argv[2])) _exit(126); unsetenv("TERM_PROGRAM"); setenv("TERM", "xterm-256color", 1); char *args[] = { argv[1], NULL }; execv(argv[1], args); _exit(127); }
  if (child < 0) return 3;
  FILE *out = fopen(argv[3], "wb"); if (!out) return 4;
  fcntl(master, F_SETFL, fcntl(master, F_GETFL) | O_NONBLOCK);
  struct timespec start, now; clock_gettime(CLOCK_MONOTONIC, &start);
  int cold = !strcmp(argv[4], "cold"), reader = !strcmp(argv[4], "reader"), github = !strcmp(argv[4], "github"), mouse = !strcmp(argv[4], "mouse"), source = !strncmp(argv[4], "source-", 7) || !strcmp(argv[4], "github"), mouseEnabled = 0, step = 0, status, alternate = 0, failed = 0; const char *level = github ? "global" : (source ? argv[4] + 7 : ""); long alternateAt = 0; char buffer[4096]; ssize_t count;
  clear_screen();
  for (;;) {
    while ((count = read(master, buffer, sizeof buffer)) > 0) {
      fwrite(buffer, 1, count, out); fflush(out);
      for (ssize_t i = 0; i < count; i++) put_byte((unsigned char)buffer[i]);
      for (ssize_t i = 0; i + 7 < count; i++) if (!memcmp(buffer + i, "\\033[?1049h", 8)) alternate = 1;
      for (ssize_t i = 0; i + 7 < count; i++) if (!memcmp(buffer + i, "\\033[?1006h", 8)) mouseEnabled = 1;
    }
    if (waitpid(child, &status, WNOHANG) == child) break;
    clock_gettime(CLOCK_MONOTONIC, &now);
    long elapsed = (now.tv_sec - start.tv_sec) * 1000 + (now.tv_nsec - start.tv_nsec) / 1000000;
    if (alternate && !alternateAt) alternateAt = elapsed;
    if (cold && alternateAt && step == 0 && elapsed - alternateAt >= 1800) { failed |= !checkpoint("cold-start", "Add your first Skill") || !checkpoint("cold-action", "Add a Source") || !checkpoint("cold-instructions", "Discover"); send_bytes(master, "\\r"); step++; }
    else if (cold && alternateAt && step == 1 && elapsed - alternateAt >= 2300) { failed |= !checkpoint("cold-add-source", "Add Source"); if (config_has(argv[2], "fixture-source")) { fprintf(stderr, "PTY cold-start Enter mutated project config\\n"); failed = 1; } struct termios settings; tcgetattr(master, &settings); settings.c_lflag |= ISIG; settings.c_cc[VINTR] = 3; tcsetattr(master, TCSANOW, &settings); unsigned char ctrlc = 3; write(master, &ctrlc, 1); step = 99; }
    else if (source && alternateAt && step == 0 && elapsed - alternateAt >= 1800) { failed |= !checkpoint("source-start", "Workspace"); send_bytes(master, "\\020"); step++; }
    else if (source && alternateAt && step == 1 && elapsed - alternateAt >= 2300) { failed |= !checkpoint("source-palette", "Global"); if (!strcmp(level, "project")) send_bytes(master, "\\033[B\\033[B\\r"); else if (!strcmp(level, "local")) send_bytes(master, "\\033[B\\033[B\\033[B\\r"); else send_bytes(master, "\\033[B\\r"); step++; }
    else if (source && alternateAt && step == 2 && elapsed - alternateAt >= 2900) { failed |= !checkpoint("source-config", "Config") || !checkpoint("source-section", "Sources"); send_bytes(master, "\\r"); step++; }
    else if (source && !strcmp(level, "project") && alternateAt && step == 3 && elapsed - alternateAt >= 3400) { failed |= !checkpoint("source-actions", "Add Source"); send_bytes(master, "\\033[B\\033[B\\033[B\\033[B\\033[B\\r"); step++; }
    else if (source && strcmp(level, "project") && alternateAt && step == 3 && elapsed - alternateAt >= 3400) { failed |= !checkpoint("add-source", "Add Source"); step++; }
    else if (github && alternateAt && step == 4 && elapsed - alternateAt >= 3900) { failed |= !checkpoint("add-source", "Add Source"); send_bytes(master, "\\033[B\\033[B\\033[B\\033[B\\033[B\\r"); step++; }
    else if (github && alternateAt && step == 5 && elapsed - alternateAt >= 4300) { send_bytes(master, "\\t"); step++; }
    else if (github && alternateAt && step == 6 && elapsed - alternateAt >= 4600) { send_bytes(master, "github-cancel"); step++; }
    else if (github && alternateAt && step == 7 && elapsed - alternateAt >= 4900) { send_bytes(master, "\\t"); step++; }
    else if (github && alternateAt && step == 8 && elapsed - alternateAt >= 5200) { send_bytes(master, "owner"); step++; }
    else if (github && alternateAt && step == 9 && elapsed - alternateAt >= 5500) { send_bytes(master, "\\t"); step++; }
    else if (github && alternateAt && step == 10 && elapsed - alternateAt >= 5800) { send_bytes(master, "repository"); step++; }
    else if (github && alternateAt && step == 11 && elapsed - alternateAt >= 6200) { failed |= !checkpoint("github-owner", "owner") || !checkpoint("github-repository", "repository") || !checkpoint("github-cancel", "Cancel"); send_bytes(master, "\\033"); step++; }
    else if (github && alternateAt && step == 12 && elapsed - alternateAt >= 6800) { if (level_has(argv[2], "global", "github-cancel")) { fprintf(stderr, "PTY github cancel mutated global config\\n"); failed = 1; } struct termios settings; tcgetattr(master, &settings); settings.c_lflag |= ISIG; settings.c_cc[VINTR] = 3; tcsetattr(master, TCSANOW, &settings); unsigned char ctrlc = 3; write(master, &ctrlc, 1); step++; }
    else if (source && !github && alternateAt && step == 4 && elapsed - alternateAt >= 3900) { send_bytes(master, "\\t"); step++; }
    else if (source && !github && alternateAt && step == 5 && elapsed - alternateAt >= 4200) { char id[64]; snprintf(id, sizeof id, "source-%s", level); send_bytes(master, id); step++; }
    else if (source && !github && alternateAt && step == 6 && elapsed - alternateAt >= 4600) { send_bytes(master, "\\t"); step++; }
    else if (source && !github && alternateAt && step == 7 && elapsed - alternateAt >= 4900) { char origin[4096]; const char *slash = strrchr(argv[2], '/'); snprintf(origin, sizeof origin, "%.*s/fixture-source-root", (int)(slash - argv[2]), argv[2]); send_bytes(master, origin); step++; }
    else if (source && !github && alternateAt && step == 8 && elapsed - alternateAt >= 5300) { send_bytes(master, "\\tfixture"); step++; }
    else if (source && !github && alternateAt && step == 9 && elapsed - alternateAt >= 5700) { send_bytes(master, "\\t"); step++; }
    else if (source && !github && alternateAt && step == 10 && elapsed - alternateAt >= 6000) { send_bytes(master, "\\033[B\\r"); step++; }
    else if (source && !github && alternateAt && step == 11 && elapsed - alternateAt >= 7400) { char id[64]; snprintf(id, sizeof id, "source-%s", level); failed |= !checkpoint("source-created", id); if (!level_has(argv[2], level, id)) { fprintf(stderr, "PTY checkpoint %s config missing %s\\n", level, id); failed = 1; } struct termios settings; tcgetattr(master, &settings); settings.c_lflag |= ISIG; settings.c_cc[VINTR] = 3; tcsetattr(master, TCSANOW, &settings); unsigned char ctrlc = 3; write(master, &ctrlc, 1); step++; }
    else if (mouse && alternateAt && step == 0 && elapsed - alternateAt >= 1800) { if (!mouseEnabled) { fprintf(stderr, "PTY mouse protocol 1006 was not enabled\\n"); failed = 1; } send_bytes(master, "\\033"); step = 100; }
    else if (mouse && alternateAt && step == 100 && elapsed - alternateAt >= 2200) { send_bytes(master, "\\033[C"); step = 101; }
    else if (mouse && alternateAt && step == 101 && elapsed - alternateAt >= 2600) { failed |= !checkpoint("mouse-collections", "Collections"); send_bytes(master, "\\r"); step = 102; }
    else if (mouse && alternateAt && step == 102 && elapsed - alternateAt >= 3000) { send_bytes(master, "\\t"); step = 103; }
    else if (mouse && alternateAt && step == 103 && elapsed - alternateAt >= 3300) { send_bytes(master, "\\t"); step = 104; }
    else if (mouse && alternateAt && step == 104 && elapsed - alternateAt >= 3600) { send_bytes(master, "\\r"); step = 105; }
    else if (mouse && alternateAt && step == 105 && elapsed - alternateAt >= 4100) { int column, row; char sgr[64]; failed |= !checkpoint("mouse-overlay-dimensions", "Search dimensions"); memcpy(mouse_before, screen, sizeof screen); if (!locate("Search dimensions", &column, &row) || ++row > height) { checkpoint("mouse collection dimension", "Search dimensions"); failed = 1; } else { snprintf(sgr, sizeof sgr, "\\033[<0;%d;%dM\\033[<3;%d;%dm", column, row, column, row); send_bytes(master, sgr); } step = 106; }
    else if (mouse && alternateAt && step == 106 && elapsed - alternateAt >= 4700) { failed |= !checkpoint("mouse-overlay-values", "1/1"); if (!memcmp(mouse_before, screen, sizeof screen)) { fprintf(stderr, "PTY mouse dimension click did not change the active screen\\n"); failed = 1; } struct termios settings; tcgetattr(master, &settings); settings.c_lflag |= ISIG; settings.c_cc[VINTR] = 3; tcsetattr(master, TCSANOW, &settings); unsigned char ctrlc = 3; write(master, &ctrlc, 1); step++; }
    else if (!cold && !reader && !source && !mouse && alternateAt && step == 0 && elapsed - alternateAt >= 1800) { failed |= !checkpoint("startup", "Workspace") || !checkpoint("skills", "Installed Skills") || !checkpoint("fixture", "fixture"); send_bytes(master, "\\033"); step++; }
    else if (!cold && !reader && !source && alternateAt && step == 1 && elapsed - alternateAt >= 2200) { send_bytes(master, "\\033"); step++; }
    else if (!reader && !source && alternateAt && step == 2 && elapsed - alternateAt >= 2600) { send_bytes(master, "\\033[C"); step++; }
    else if (!reader && !source && alternateAt && step == 3 && elapsed - alternateAt >= 3100) { failed |= !checkpoint("global selected", "Global Config") || !checkpoint("global destination", "Global Config"); send_bytes(master, "\\t"); step++; }
    else if (!reader && !source && alternateAt && step == 4 && elapsed - alternateAt >= 3600) { failed |= !checkpoint("global-sections", "Sources"); send_bytes(master, "\\033[C\\033[C"); step++; }
    else if (!reader && !source && alternateAt && step == 5 && elapsed - alternateAt >= 4100) { failed |= !checkpoint("global-collections", "Collections"); send_bytes(master, "\\r"); step++; }
    else if (!reader && !source && alternateAt && step == 6 && elapsed - alternateAt >= 4600) { failed |= !checkpoint("global-collections-empty", "No Collections yet") || !checkpoint("global-new-collection", "New Collection"); send_bytes(master, "\\r"); step++; }
    else if (!reader && !source && alternateAt && step == 7 && elapsed - alternateAt >= 5100) { failed |= !checkpoint("new-collection-action", "Create Collection"); resize_pty(master, child, 80, 24); step++; }
    else if (!reader && !source && alternateAt && step == 8 && elapsed - alternateAt >= 5600) { failed |= !checkpoint("narrow-form", "Create Collection"); resize_pty(master, child, 43, 24); step++; }
    else if (!reader && !source && alternateAt && step == 9 && elapsed - alternateAt >= 5950) { failed |= !checkpoint("compact-form", "Create Collection"); resize_pty(master, child, 120, 40); step++; }
    else if (!reader && !source && alternateAt && step == 10 && elapsed - alternateAt >= 6300) { failed |= !checkpoint("restored-form", "Create Collection"); send_bytes(master, "pty-created"); step++; }
    else if (!reader && !source && alternateAt && step == 11 && elapsed - alternateAt >= 6700) { send_bytes(master, "\\t"); step++; }
    else if (!reader && !source && alternateAt && step == 12 && elapsed - alternateAt >= 7000) { send_bytes(master, "\\033[B\\r"); step++; }
    else if (!reader && !source && alternateAt && step == 13 && elapsed - alternateAt >= 7600) { failed |= !checkpoint("created", "pty-created"); if (!level_has(argv[2], "global", "pty-created")) { fprintf(stderr, "PTY checkpoint global-config missing pty-created\\n"); failed = 1; } step++; }
    else if (!reader && !source && alternateAt && step == 14 && elapsed - alternateAt >= 8400) { send_bytes(master, "\\020"); step++; }
    else if (!reader && !source && alternateAt && step == 15 && elapsed - alternateAt >= 8800) { failed |= !checkpoint("collection-palette", "New Collection"); send_bytes(master, "\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B"); step++; }
    else if (!reader && !source && alternateAt && step == 16 && elapsed - alternateAt >= 9200) { failed |= !checkpoint("collection-actions", "Add Link") || !checkpoint("collection-remove-action", "Remove Collection"); send_bytes(master, "\\033[B"); step++; }
    else if (!reader && !source && alternateAt && step == 17 && elapsed - alternateAt >= 9500) { send_bytes(master, "\\r"); step++; }
    else if (!reader && !source && alternateAt && step == 18 && elapsed - alternateAt >= 10100) { failed |= !checkpoint("remove-review", "Remove Collection"); send_bytes(master, "\\r"); step++; }
    else if (!reader && !source && alternateAt && step == 19 && elapsed - alternateAt >= 10500) { failed |= !checkpoint("cancelled-remove", "pty-created"); send_bytes(master, "\\020"); step++; }
    else if (!reader && !source && alternateAt && step == 20 && elapsed - alternateAt >= 10900) { failed |= !checkpoint("collection-palette-repeat", "New Collection"); send_bytes(master, "\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B\\033[B"); step++; }
    else if (!reader && !source && alternateAt && step == 21 && elapsed - alternateAt >= 11300) { failed |= !checkpoint("collection-actions-repeat", "Add Link") || !checkpoint("collection-remove-action-repeat", "Remove Collection"); send_bytes(master, "\\r"); step++; }
    else if (!reader && !source && alternateAt && step == 22 && elapsed - alternateAt >= 11900) { failed |= !checkpoint("remove-review-repeat", "Remove Collection"); send_bytes(master, "\\033[B\\r"); step++; }
    else if (!reader && !source && alternateAt && step == 23 && elapsed - alternateAt >= 12900) { if (level_has(argv[2], "global", "pty-created")) { fprintf(stderr, "PTY checkpoint global-config retained pty-created after removal\\n"); failed = 1; } failed |= !checkpoint("removed", "Collections"); struct termios settings; tcgetattr(master, &settings); settings.c_lflag |= ISIG; settings.c_cc[VINTR] = 3; tcsetattr(master, TCSANOW, &settings); unsigned char ctrlc = 3; write(master, &ctrlc, 1); step++; }
    else if (reader && alternateAt && step == 0 && elapsed - alternateAt >= 1800) { failed |= !checkpoint("reader-start", "fixture"); send_bytes(master, "\\r"); step++; }
    else if (reader && alternateAt && step == 1 && elapsed - alternateAt >= 2100) { send_bytes(master, "\\033[Z"); step++; }
    else if (reader && alternateAt && step == 2 && elapsed - alternateAt >= 2400) { send_bytes(master, "\\t"); step++; }
    else if (reader && alternateAt && step == 3 && elapsed - alternateAt >= 2800) { failed |= !checkpoint("reader-tabs", "SKILL.md"); send_bytes(master, "\\033[C\\033[C"); step++; }
    else if (reader && alternateAt && step == 4 && elapsed - alternateAt >= 3200) { failed |= !checkpoint("reader-details", "Details"); send_bytes(master, "\\t"); step++; }
    else if (reader && alternateAt && step == 5 && elapsed - alternateAt >= 3600) { failed |= !checkpoint("reader-actions", "Actions"); send_bytes(master, "\\003"); step++; }
    else if (reader && alternateAt && step == 6 && elapsed - alternateAt >= 4000) { struct termios settings; tcgetattr(master, &settings); settings.c_lflag |= ISIG; settings.c_cc[VINTR] = 3; tcsetattr(master, TCSANOW, &settings); unsigned char ctrlc = 3; write(master, &ctrlc, 1); step++; }
    if (elapsed >= 18000) { kill(child, SIGKILL); waitpid(child, &status, 0); fclose(out); return 124; }
    usleep(10000);
  }
  while ((count = read(master, buffer, sizeof buffer)) > 0) fwrite(buffer, 1, count, out);
  fclose(out); close(master);
  if (failed) { char global[4096], project[4096], local[4096]; const char *slash = strrchr(argv[2], '/'); snprintf(project, sizeof project, "%s/skill-cli.jsonc", argv[2]); snprintf(local, sizeof local, "%s/skill-cli.local.jsonc", argv[2]); if (slash) snprintf(global, sizeof global, "%.*s/xdg-config/skill-cli/config.jsonc", (int)(slash - argv[2]), argv[2]); else strcpy(global, "<unknown>"); fprintf(stderr, "PTY failure mode=%s step=%d child-status=%d exit=%d\\n", argv[4], step, status, WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status)); for (int row = 0; row < height; row++) fprintf(stderr, "%.*s\\n", width, screen[row]); print_file("global-config", global); print_file("project-config", project); print_file("local-config", local); return 125; }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
`;
  if (target === "win32")
    return `#define _WIN32_WINNT 0x0A00
#include <windows.h>
 #include <consoleapi2.h>
 #include <stdio.h>
 static void close_handle(HANDLE *handle) { if (*handle && *handle != INVALID_HANDLE_VALUE) { CloseHandle(*handle); *handle = NULL; } }
 static void close_console(HPCON *console) { if (*console) { ClosePseudoConsole(*console); *console = NULL; } }
 int main(int argc, char **argv) {
  if (argc != 3) return 2;
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
  char command[32768]; snprintf(command, sizeof(command), "%c%s%c", 34, argv[1], 34);
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
  throw new Error(`Unsupported native terminal target ${target}`);
}

async function tui(
  artifact: string,
  outputRoot: string,
  mode:
    | "cold"
    | "navigation"
    | "reader"
    | "source-global"
    | "source-project"
    | "source-local"
    | "github"
    | "mouse",
): Promise<void> {
  const transcript = join(outputRoot, `tui-${mode}.typescript`);
  const source = join(
    outputRoot,
    process.platform === "win32" ? "pty-controller.c" : "pty-controller.c",
  );
  const controller = join(
    outputRoot,
    process.platform === "win32" ? "pty-controller.exe" : "pty-controller",
  );
  await writeFile(source, terminalControllerSource());
  const compileArgs =
    process.platform === "linux"
      ? ["cc", source, "-lutil", "-o", controller]
      : process.platform === "darwin"
        ? ["cc", source, "-o", controller]
        : ["cl", "/nologo", source, "/Fe:" + controller];
  const compile = Bun.spawn(compileArgs, {
    cwd: outputRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const compileCode = await compile.exited;
  assert(
    compileCode === 0,
    `Unable to bootstrap Linux PTY controller: ${await new Response(compile.stderr).text()}`,
  );
  const child = Bun.spawn(
    [controller, artifact, join(outputRoot, "fixture-project"), transcript, mode],
    {
      cwd: outputRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: isolatedEnvironment(outputRoot),
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const rendered = `${await readFile(transcript, "utf8")}${stdout}`;
  assert(exitCode === 0 || exitCode === 130, `TUI exited ${exitCode}: ${stderr}`);
  assert(
    rendered.includes("\u001B[?1049h"),
    `TUI did not enter an alternate terminal screen: ${JSON.stringify(rendered.slice(-400))}`,
  );
  assert(
    rendered.includes("\u001B[?1049l"),
    `TUI did not restore the terminal screen on exit: ${JSON.stringify(rendered.slice(-400))}`,
  );
}

export async function runPackagedSmoke(options: SmokeOptions): Promise<void> {
  const before = await lstat(options.outputRoot).catch(() => undefined);
  if (before !== undefined)
    assert(
      before.isDirectory() && (await readdir(options.outputRoot)).length === 0,
      "--output-root must be fresh and empty",
    );
  else await mkdir(options.outputRoot, { recursive: true });
  try {
    const artifact = await stat(options.artifact);
    assert(artifact.isFile(), "Artifact is not a regular file");
    assert(basename(options.artifact) === expectedArtifactName(), "Artifact target name differs");
    if (process.platform !== "win32")
      assert((artifact.mode & 0o111) !== 0, "Artifact is not executable");
    await runPackagedCheck(packagedChecks[0].name, async () => {
      assert((await readFile(options.artifact)).length > 0, "Artifact is empty");
    });
    const sourceRoot = join(options.outputRoot, "fixture-source-root");
    const project = join(options.outputRoot, "fixture-project");
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
    await tui(options.artifact, options.outputRoot, "cold");
    await runPackagedCheck(packagedChecks[1].name, async () => {
      for (const argv of [
        ["source", "register", "local", "fixture-source", sourceRoot, "--level", "project"],
        ["source", "discover", "fixture-source"],
        ["install", "fixture-source", "fixture"],
      ] as const) {
        const result = await invoke(
          [options.artifact, "--project", project, ...argv],
          project,
          options.outputRoot,
        );
        assert(
          result.exitCode === 0 && result.stderr.length === 0,
          `management command failed: ${argv.join(" ")} (${result.exitCode})\n${text(result.stdout)}${text(result.stderr)}`,
        );
      }
    });
    await runPackagedCheck(packagedChecks[2].name, async () => {
      for (const argv of [
        [
          "collection",
          "member",
          "add",
          "fixture-collection",
          "fixture",
          "fixture-source",
          "fixture",
        ],
        ["use", "set", "fixture-collection"],
        ["managed", "set"],
      ] as const) {
        const result = await invoke(
          [options.artifact, "--project", project, ...argv],
          project,
          options.outputRoot,
        );
        assert(
          result.exitCode === 0 && result.stderr.length === 0,
          `configuration command failed: ${argv.join(" ")} (${result.exitCode})\n${text(result.stdout)}${text(result.stderr)}`,
        );
      }
      const rootBrowse = await invoke(
        [options.artifact, "--project", project, "agent", "browse"],
        project,
        options.outputRoot,
      );
      const rootBrowseBody = JSON.parse(text(rootBrowse.stdout));
      assert(
        rootBrowse.exitCode === 0 &&
          rootBrowse.stderr.length === 0 &&
          rootBrowseBody.scope.kind === "root" &&
          rootBrowseBody.items[0].id === "fixture-collection",
        "agent root browse differs",
      );
      const collectionBrowse = await invoke(
        [options.artifact, "--project", project, "agent", "browse", "fixture-collection"],
        project,
        options.outputRoot,
      );
      const collectionBrowseBody = JSON.parse(text(collectionBrowse.stdout));
      assert(
        collectionBrowse.exitCode === 0 &&
          collectionBrowse.stderr.length === 0 &&
          collectionBrowseBody.scope.id === "fixture-collection" &&
          collectionBrowseBody.items[0].selector === "fixture-collection:fixture",
        "agent collection browse differs",
      );
      const load = await invoke(
        [options.artifact, "--project", project, "agent", "load", "fixture-collection:fixture"],
        project,
        options.outputRoot,
      );
      assert(
        load.exitCode === 0 &&
          load.stderr.length === 0 &&
          JSON.parse(text(load.stdout)).text === skillBytes,
        "agent load bytes differ",
      );
      const read = await invoke(
        [
          options.artifact,
          "--project",
          project,
          "agent",
          "read",
          "fixture-collection:fixture",
          "run.ts",
        ],
        project,
        options.outputRoot,
      );
      assert(
        read.exitCode === 0 &&
          read.stderr.length === 0 &&
          JSON.parse(text(read.stdout)).text.includes(marker),
        "agent read bytes differ",
      );
    });
    await runPackagedCheck(packagedChecks[3].name, async () => {
      const result = await invoke(
        [
          options.artifact,
          "--project",
          project,
          "agent",
          "run",
          "fixture-collection:fixture",
          "--",
          process.execPath,
          "run.ts",
          marker,
        ],
        project,
        options.outputRoot,
      );
      assert(
        result.exitCode === 0 &&
          result.stderr.length === 0 &&
          text(result.stdout).includes(marker) &&
          (finalJson(result.stdout) as { exitCode: number }).exitCode === 7,
        `agent run did not preserve cwd, marker, or status: ${JSON.stringify(text(result.stdout))}`,
      );
    });
    await runPackagedCheck(packagedChecks[4].name, async () => {
      const output = join(options.outputRoot, "download.bin");
      const result = await invoke(
        [
          options.artifact,
          "--project",
          project,
          "agent",
          "download",
          "fixture-collection:fixture",
          "assets/payload.bin",
          "--output",
          output,
        ],
        project,
        options.outputRoot,
      );
      assert(
        result.exitCode === 0 &&
          JSON.parse(text(result.stdout)).bytesWritten === payload.length &&
          result.stderr.length === 0,
        "agent download channels differ",
      );
      assert(Buffer.compare(await readFile(output), payload) === 0, "agent download bytes differ");
      const hardLink = join(options.outputRoot, "download-hard-link.bin");
      await link(output, hardLink);
      const outputLink = join(options.outputRoot, "download-link.bin");
      await symlink(hardLink, outputLink);
      const linked = await invoke(
        [
          options.artifact,
          "--project",
          project,
          "agent",
          "download",
          "fixture-collection:fixture",
          "assets/payload.bin",
          "--output",
          outputLink,
        ],
        project,
        options.outputRoot,
      );
      assert(
        linked.exitCode === 1 && (await lstat(outputLink)).isSymbolicLink(),
        "download replaced an existing symlink",
      );
      const replacement = new Uint8Array([3, 4, 5, 6]);
      await writeFile(join(skill, "assets", "payload.bin"), replacement);
      const handle = await open(output, "r");
      try {
        const forced = await invoke(
          [
            options.artifact,
            "--project",
            project,
            "agent",
            "download",
            "fixture-collection:fixture",
            "assets/payload.bin",
            "--output",
            output,
            "--force",
          ],
          project,
          options.outputRoot,
        );
        assert(
          forced.exitCode === 0 &&
            JSON.parse(text(forced.stdout)).bytesWritten === replacement.length &&
            forced.stderr.length === 0,
          "forced download failed with an open destination",
        );
      } finally {
        await handle.close();
      }
      assert(
        Buffer.compare(await readFile(output), replacement) === 0,
        "forced download did not publish replacement bytes",
      );
      assert(
        Buffer.compare(await readFile(hardLink), payload) === 0,
        "forced download did not atomically replace the hard-linked destination",
      );
      await chmod(output, 0o600);
    });
    await runPackagedCheck(packagedChecks[5].name, async () => {
      await tui(options.artifact, options.outputRoot, "reader");
      await tui(options.artifact, options.outputRoot, "navigation");
      await tui(options.artifact, options.outputRoot, "source-global");
      await tui(options.artifact, options.outputRoot, "source-project");
      await tui(options.artifact, options.outputRoot, "source-local");
      await tui(options.artifact, options.outputRoot, "github");
      await tui(options.artifact, options.outputRoot, "mouse");
    });
  } finally {
    await rm(options.outputRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) await runPackagedSmoke(parseSmokeOptions(process.argv.slice(2)));
