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
static char screen[40][121], mouse_before[40][121]; static int width = 120, height = 40, x, y, saved_x, saved_y, esc, utf8_needed, utf8_min, params[8], count, value; static unsigned int utf8_code;
static void clear_screen(void) { for (int row = 0; row < 40; row++) memset(screen[row], ' ', 120); x = y = 0; }
static int parameter(int fallback) { return count ? params[0] : fallback; }
static void advance_cell(void) { if (++x >= width) { x = 0; if (++y >= height) y = height - 1; } }
static int in_range(unsigned int codepoint, unsigned int first, unsigned int last) { return codepoint >= first && codepoint <= last; }
/* This is a codepoint-width model, not grapheme segmentation. It covers the combining,
   variation-selector, East Asian, and emoji ranges that affect ordinary terminal UI text. */
static int cell_width(unsigned int codepoint) {
  if (in_range(codepoint, 0x0300, 0x036f) || in_range(codepoint, 0x0483, 0x0489) || in_range(codepoint, 0x0591, 0x05bd) || codepoint == 0x05bf || in_range(codepoint, 0x05c1, 0x05c2) || in_range(codepoint, 0x05c4, 0x05c5) || codepoint == 0x05c7 || in_range(codepoint, 0x0610, 0x061a) || in_range(codepoint, 0x064b, 0x065f) || codepoint == 0x0670 || in_range(codepoint, 0x06d6, 0x06ed) || in_range(codepoint, 0x0711, 0x0711) || in_range(codepoint, 0x0730, 0x074a) || in_range(codepoint, 0x07a6, 0x07b0) || in_range(codepoint, 0x07eb, 0x07f3) || in_range(codepoint, 0x0816, 0x0819) || in_range(codepoint, 0x081b, 0x0823) || in_range(codepoint, 0x0825, 0x0827) || in_range(codepoint, 0x0829, 0x082d) || in_range(codepoint, 0x0859, 0x085b) || in_range(codepoint, 0x08d3, 0x0902) || in_range(codepoint, 0x093a, 0x093a) || in_range(codepoint, 0x093c, 0x093c) || in_range(codepoint, 0x0941, 0x0948) || in_range(codepoint, 0x094d, 0x094d) || in_range(codepoint, 0x0951, 0x0957) || in_range(codepoint, 0x0962, 0x0963) || in_range(codepoint, 0x0981, 0x0981) || in_range(codepoint, 0x09bc, 0x09bc) || in_range(codepoint, 0x09c1, 0x09c4) || in_range(codepoint, 0x09cd, 0x09cd) || in_range(codepoint, 0x09e2, 0x09e3) || in_range(codepoint, 0x0a01, 0x0a02) || in_range(codepoint, 0x0a3c, 0x0a3c) || in_range(codepoint, 0x0a41, 0x0a42) || in_range(codepoint, 0x0a47, 0x0a48) || in_range(codepoint, 0x0a4b, 0x0a4d) || in_range(codepoint, 0x0a51, 0x0a51) || in_range(codepoint, 0x0a70, 0x0a71) || in_range(codepoint, 0x0a75, 0x0a75) || in_range(codepoint, 0x0a81, 0x0a82) || in_range(codepoint, 0x0abc, 0x0abc) || in_range(codepoint, 0x0ac1, 0x0ac5) || in_range(codepoint, 0x0ac7, 0x0ac8) || in_range(codepoint, 0x0acd, 0x0acd) || in_range(codepoint, 0x0ae2, 0x0ae3) || in_range(codepoint, 0x0b01, 0x0b01) || in_range(codepoint, 0x0b3c, 0x0b3c) || in_range(codepoint, 0x0b3f, 0x0b3f) || in_range(codepoint, 0x0b41, 0x0b44) || in_range(codepoint, 0x0b4d, 0x0b4d) || in_range(codepoint, 0x0b56, 0x0b56) || in_range(codepoint, 0x0b62, 0x0b63) || in_range(codepoint, 0x0b82, 0x0b82) || in_range(codepoint, 0x0bc0, 0x0bc0) || in_range(codepoint, 0x0bcd, 0x0bcd) || in_range(codepoint, 0x0c00, 0x0c00) || in_range(codepoint, 0x0c04, 0x0c04) || in_range(codepoint, 0x0c3e, 0x0c40) || in_range(codepoint, 0x0c46, 0x0c48) || in_range(codepoint, 0x0c4a, 0x0c4d) || in_range(codepoint, 0x0c55, 0x0c56) || in_range(codepoint, 0x0c62, 0x0c63) || in_range(codepoint, 0x0c81, 0x0c81) || in_range(codepoint, 0x0cbc, 0x0cbc) || in_range(codepoint, 0x0cbf, 0x0cbf) || in_range(codepoint, 0x0cc6, 0x0cc6) || in_range(codepoint, 0x0ccc, 0x0ccd) || in_range(codepoint, 0x0ce2, 0x0ce3) || in_range(codepoint, 0x0d00, 0x0d01) || in_range(codepoint, 0x0d3b, 0x0d3c) || in_range(codepoint, 0x0d41, 0x0d44) || in_range(codepoint, 0x0d4d, 0x0d4d) || in_range(codepoint, 0x0d62, 0x0d63) || in_range(codepoint, 0x0dca, 0x0dca) || in_range(codepoint, 0x0dd2, 0x0dd4) || in_range(codepoint, 0x0dd6, 0x0dd6) || in_range(codepoint, 0x0e31, 0x0e31) || in_range(codepoint, 0x0e34, 0x0e3a) || in_range(codepoint, 0x0e47, 0x0e4e) || in_range(codepoint, 0x0eb1, 0x0eb1) || in_range(codepoint, 0x0eb4, 0x0ebc) || in_range(codepoint, 0x0ec8, 0x0ecd) || in_range(codepoint, 0x0f18, 0x0f19) || in_range(codepoint, 0x0f35, 0x0f35) || in_range(codepoint, 0x0f37, 0x0f37) || in_range(codepoint, 0x0f39, 0x0f39) || in_range(codepoint, 0x0f71, 0x0f7e) || in_range(codepoint, 0x0f80, 0x0f84) || in_range(codepoint, 0x0f86, 0x0f87) || in_range(codepoint, 0x0f8d, 0x0f97) || in_range(codepoint, 0x0f99, 0x0fbc) || in_range(codepoint, 0x0fc6, 0x0fc6) || in_range(codepoint, 0x102d, 0x1030) || in_range(codepoint, 0x1032, 0x1037) || in_range(codepoint, 0x1039, 0x103a) || in_range(codepoint, 0x103d, 0x103e) || in_range(codepoint, 0x1058, 0x1059) || in_range(codepoint, 0x105e, 0x1060) || in_range(codepoint, 0x1071, 0x1074) || in_range(codepoint, 0x1082, 0x1082) || in_range(codepoint, 0x1085, 0x1086) || in_range(codepoint, 0x108d, 0x108d) || in_range(codepoint, 0x109d, 0x109d) || in_range(codepoint, 0x135d, 0x135f) || in_range(codepoint, 0x1712, 0x1714) || in_range(codepoint, 0x1732, 0x1734) || in_range(codepoint, 0x1752, 0x1753) || in_range(codepoint, 0x1772, 0x1773) || in_range(codepoint, 0x17b4, 0x17b5) || in_range(codepoint, 0x17b7, 0x17bd) || in_range(codepoint, 0x17c6, 0x17c6) || in_range(codepoint, 0x17c9, 0x17d3) || in_range(codepoint, 0x17dd, 0x17dd) || in_range(codepoint, 0x180b, 0x180f) || in_range(codepoint, 0x1885, 0x1886) || in_range(codepoint, 0x18a9, 0x18a9) || in_range(codepoint, 0x1920, 0x1922) || in_range(codepoint, 0x1927, 0x1928) || in_range(codepoint, 0x1932, 0x1932) || in_range(codepoint, 0x1939, 0x193b) || in_range(codepoint, 0x1a17, 0x1a18) || in_range(codepoint, 0x1a1b, 0x1a1b) || in_range(codepoint, 0x1a56, 0x1a56) || in_range(codepoint, 0x1a58, 0x1a5e) || in_range(codepoint, 0x1a60, 0x1a60) || in_range(codepoint, 0x1a62, 0x1a62) || in_range(codepoint, 0x1a65, 0x1a6c) || in_range(codepoint, 0x1a73, 0x1a7c) || in_range(codepoint, 0x1a7f, 0x1a7f) || in_range(codepoint, 0x1ab0, 0x1aff) || in_range(codepoint, 0x1b00, 0x1b03) || in_range(codepoint, 0x1b34, 0x1b34) || in_range(codepoint, 0x1b36, 0x1b3a) || in_range(codepoint, 0x1b3c, 0x1b3c) || in_range(codepoint, 0x1b42, 0x1b42) || in_range(codepoint, 0x1b6b, 0x1b73) || in_range(codepoint, 0x1b80, 0x1b81) || in_range(codepoint, 0x1ba2, 0x1ba5) || in_range(codepoint, 0x1ba8, 0x1ba9) || in_range(codepoint, 0x1bab, 0x1bad) || in_range(codepoint, 0x1be6, 0x1be6) || in_range(codepoint, 0x1be8, 0x1be9) || in_range(codepoint, 0x1bed, 0x1bed) || in_range(codepoint, 0x1bef, 0x1bf1) || in_range(codepoint, 0x1c2c, 0x1c33) || in_range(codepoint, 0x1c36, 0x1c37) || in_range(codepoint, 0x1cd0, 0x1cd2) || in_range(codepoint, 0x1cd4, 0x1ce0) || in_range(codepoint, 0x1ce2, 0x1ce8) || in_range(codepoint, 0x1ced, 0x1ced) || in_range(codepoint, 0x1cf4, 0x1cf4) || in_range(codepoint, 0x1cf8, 0x1cf9) || in_range(codepoint, 0x1dc0, 0x1dff) || in_range(codepoint, 0x20d0, 0x20ff) || in_range(codepoint, 0x2cef, 0x2cf1) || in_range(codepoint, 0x2d7f, 0x2d7f) || in_range(codepoint, 0x2de0, 0x2dff) || in_range(codepoint, 0x302a, 0x302f) || in_range(codepoint, 0x3099, 0x309a) || in_range(codepoint, 0xa66f, 0xa672) || in_range(codepoint, 0xa674, 0xa67d) || in_range(codepoint, 0xa69e, 0xa69f) || in_range(codepoint, 0xa6f0, 0xa6f1) || in_range(codepoint, 0xa802, 0xa802) || in_range(codepoint, 0xa806, 0xa806) || in_range(codepoint, 0xa80b, 0xa80b) || in_range(codepoint, 0xa825, 0xa826) || in_range(codepoint, 0xa8c4, 0xa8c5) || in_range(codepoint, 0xa8e0, 0xa8f1) || in_range(codepoint, 0xa926, 0xa92d) || in_range(codepoint, 0xa947, 0xa951) || in_range(codepoint, 0xa980, 0xa982) || in_range(codepoint, 0xa9b3, 0xa9b3) || in_range(codepoint, 0xa9b6, 0xa9b9) || in_range(codepoint, 0xa9bc, 0xa9bd) || in_range(codepoint, 0xa9e5, 0xa9e5) || in_range(codepoint, 0xaa29, 0xaa2e) || in_range(codepoint, 0xaa31, 0xaa32) || in_range(codepoint, 0xaa35, 0xaa36) || in_range(codepoint, 0xaa43, 0xaa43) || in_range(codepoint, 0xaa4c, 0xaa4c) || in_range(codepoint, 0xaa7c, 0xaa7c) || in_range(codepoint, 0xaab0, 0xaab0) || in_range(codepoint, 0xaab2, 0xaab4) || in_range(codepoint, 0xaab7, 0xaab8) || in_range(codepoint, 0xaabe, 0xaabf) || in_range(codepoint, 0xaac1, 0xaac1) || in_range(codepoint, 0xaaec, 0xaaed) || in_range(codepoint, 0xaaf6, 0xaaf6) || in_range(codepoint, 0xabe5, 0xabe5) || in_range(codepoint, 0xabe8, 0xabe8) || in_range(codepoint, 0xabed, 0xabed) || in_range(codepoint, 0xfb1e, 0xfb1e) || in_range(codepoint, 0xfe00, 0xfe0f) || in_range(codepoint, 0xfe20, 0xfe2f) || in_range(codepoint, 0x101fd, 0x101fd) || in_range(codepoint, 0x102e0, 0x102e0) || in_range(codepoint, 0x10376, 0x1037a) || in_range(codepoint, 0x10a01, 0x10a03) || in_range(codepoint, 0x10a05, 0x10a06) || in_range(codepoint, 0x10a0c, 0x10a0f) || in_range(codepoint, 0x10a38, 0x10a3a) || in_range(codepoint, 0x10a3f, 0x10a3f) || in_range(codepoint, 0x10ae5, 0x10ae6) || in_range(codepoint, 0x11001, 0x11001) || in_range(codepoint, 0x11038, 0x11046) || in_range(codepoint, 0x1107f, 0x11081) || in_range(codepoint, 0x110b3, 0x110b6) || in_range(codepoint, 0x110b9, 0x110ba) || in_range(codepoint, 0x11100, 0x11102) || in_range(codepoint, 0x11127, 0x1112b) || in_range(codepoint, 0x1112d, 0x11134) || in_range(codepoint, 0x11173, 0x11173) || in_range(codepoint, 0x11180, 0x11181) || in_range(codepoint, 0x111b6, 0x111be) || in_range(codepoint, 0x111c9, 0x111cc) || in_range(codepoint, 0x1122f, 0x11231) || in_range(codepoint, 0x11234, 0x11234) || in_range(codepoint, 0x11236, 0x11237) || in_range(codepoint, 0x1123e, 0x1123e) || in_range(codepoint, 0x112df, 0x112df) || in_range(codepoint, 0x112e3, 0x112ea) || in_range(codepoint, 0x11300, 0x11301) || in_range(codepoint, 0x1133b, 0x1133c) || in_range(codepoint, 0x11340, 0x11340) || in_range(codepoint, 0x11366, 0x1136c) || in_range(codepoint, 0x11370, 0x11374) || in_range(codepoint, 0x11438, 0x1143f) || in_range(codepoint, 0x11442, 0x11444) || in_range(codepoint, 0x11446, 0x11446) || in_range(codepoint, 0x1145e, 0x1145e) || in_range(codepoint, 0x114b3, 0x114b8) || in_range(codepoint, 0x114ba, 0x114ba) || in_range(codepoint, 0x114bf, 0x114c0) || in_range(codepoint, 0x114c2, 0x114c3) || in_range(codepoint, 0x115b2, 0x115b5) || in_range(codepoint, 0x115bc, 0x115bd) || in_range(codepoint, 0x115bf, 0x115c0) || in_range(codepoint, 0x115dc, 0x115dd) || in_range(codepoint, 0x11633, 0x1163a) || in_range(codepoint, 0x1163d, 0x1163d) || in_range(codepoint, 0x1163f, 0x11640) || in_range(codepoint, 0x116ab, 0x116ab) || in_range(codepoint, 0x116ad, 0x116ad) || in_range(codepoint, 0x116b0, 0x116b5) || in_range(codepoint, 0x116b7, 0x116b7) || in_range(codepoint, 0x1171d, 0x1171f) || in_range(codepoint, 0x11722, 0x11725) || in_range(codepoint, 0x11727, 0x1172b) || in_range(codepoint, 0x1182f, 0x11837) || in_range(codepoint, 0x11839, 0x1183a) || in_range(codepoint, 0x1193b, 0x1193c) || in_range(codepoint, 0x1193e, 0x1193e) || in_range(codepoint, 0x11943, 0x11943) || in_range(codepoint, 0x119d4, 0x119d7) || in_range(codepoint, 0x119da, 0x119db) || in_range(codepoint, 0x119e0, 0x119e0) || in_range(codepoint, 0x11a01, 0x11a0a) || in_range(codepoint, 0x11a33, 0x11a38) || in_range(codepoint, 0x11a3b, 0x11a3e) || in_range(codepoint, 0x11a47, 0x11a47) || in_range(codepoint, 0x11a51, 0x11a56) || in_range(codepoint, 0x11a59, 0x11a5b) || in_range(codepoint, 0x11a8a, 0x11a96) || in_range(codepoint, 0x11a98, 0x11a99) || in_range(codepoint, 0x11c30, 0x11c36) || in_range(codepoint, 0x11c38, 0x11c3d) || in_range(codepoint, 0x11c3f, 0x11c3f) || in_range(codepoint, 0x11c92, 0x11ca7) || in_range(codepoint, 0x11caa, 0x11cb0) || in_range(codepoint, 0x11cb2, 0x11cb3) || in_range(codepoint, 0x11cb5, 0x11cb6) || in_range(codepoint, 0x11d31, 0x11d36) || in_range(codepoint, 0x11d3a, 0x11d3a) || in_range(codepoint, 0x11d3c, 0x11d3d) || in_range(codepoint, 0x11d3f, 0x11d45) || in_range(codepoint, 0x11d47, 0x11d47) || in_range(codepoint, 0x11d90, 0x11d91) || in_range(codepoint, 0x11d95, 0x11d95) || in_range(codepoint, 0x11d97, 0x11d97) || in_range(codepoint, 0x11ef3, 0x11ef4) || in_range(codepoint, 0x16af0, 0x16af4) || in_range(codepoint, 0x16b30, 0x16b36) || in_range(codepoint, 0x16f4f, 0x16f4f) || in_range(codepoint, 0x16f8f, 0x16f92) || in_range(codepoint, 0x1bc9d, 0x1bc9e) || in_range(codepoint, 0x1d167, 0x1d169) || in_range(codepoint, 0x1d17b, 0x1d182) || in_range(codepoint, 0x1d185, 0x1d18b) || in_range(codepoint, 0x1d1aa, 0x1d1ad) || in_range(codepoint, 0x1d242, 0x1d244) || in_range(codepoint, 0x1da00, 0x1da36) || in_range(codepoint, 0x1da3b, 0x1da6c) || in_range(codepoint, 0x1da75, 0x1da75) || in_range(codepoint, 0x1da84, 0x1da84) || in_range(codepoint, 0x1da9b, 0x1da9f) || in_range(codepoint, 0x1daa1, 0x1daaf) || in_range(codepoint, 0x1e000, 0x1e006) || in_range(codepoint, 0x1e008, 0x1e018) || in_range(codepoint, 0x1e01b, 0x1e021) || in_range(codepoint, 0x1e023, 0x1e024) || in_range(codepoint, 0x1e026, 0x1e02a) || in_range(codepoint, 0x1e08f, 0x1e08f) || in_range(codepoint, 0x1e130, 0x1e136) || in_range(codepoint, 0x1e2ae, 0x1e2ae) || in_range(codepoint, 0x1e2ec, 0x1e2ef) || in_range(codepoint, 0x1e4ec, 0x1e4ef) || in_range(codepoint, 0x1e8d0, 0x1e8d6) || in_range(codepoint, 0x1e944, 0x1e94a) || in_range(codepoint, 0x1f3fb, 0x1f3ff) || in_range(codepoint, 0xe0100, 0xe01ef)) return 0;
  if (in_range(codepoint, 0x1100, 0x115f) || in_range(codepoint, 0x231a, 0x231b) || in_range(codepoint, 0x2329, 0x232a) || in_range(codepoint, 0x23e9, 0x23ec) || codepoint == 0x23f0 || codepoint == 0x23f3 || in_range(codepoint, 0x25fd, 0x25fe) || in_range(codepoint, 0x2614, 0x2615) || in_range(codepoint, 0x2648, 0x2653) || codepoint == 0x267f || codepoint == 0x2693 || codepoint == 0x26a1 || in_range(codepoint, 0x26aa, 0x26ab) || in_range(codepoint, 0x26bd, 0x26be) || in_range(codepoint, 0x26c4, 0x26c5) || codepoint == 0x26ce || codepoint == 0x26d4 || codepoint == 0x26ea || in_range(codepoint, 0x26f2, 0x26f3) || codepoint == 0x26f5 || codepoint == 0x26fa || codepoint == 0x26fd || codepoint == 0x2705 || in_range(codepoint, 0x270a, 0x270b) || codepoint == 0x2728 || codepoint == 0x274c || codepoint == 0x274e || in_range(codepoint, 0x2753, 0x2755) || codepoint == 0x2757 || in_range(codepoint, 0x2795, 0x2797) || in_range(codepoint, 0x279b, 0x279c) || codepoint == 0x27b0 || codepoint == 0x27bf || in_range(codepoint, 0x2b1b, 0x2b1c) || codepoint == 0x2b50 || codepoint == 0x2b55 || in_range(codepoint, 0x2e80, 0xa4cf) || in_range(codepoint, 0xac00, 0xd7a3) || in_range(codepoint, 0xf900, 0xfaff) || in_range(codepoint, 0xfe10, 0xfe19) || in_range(codepoint, 0xfe30, 0xfe6f) || in_range(codepoint, 0xff01, 0xff60) || in_range(codepoint, 0xffe0, 0xffe6) || in_range(codepoint, 0x1f000, 0x1faff) || in_range(codepoint, 0x20000, 0x3fffd)) return 2;
  return 1;
}
static void put_codepoint(unsigned int codepoint) { int cells = cell_width(codepoint); while (cells-- > 0) advance_cell(); }
static void put_byte(unsigned char c) {
  if (utf8_needed) {
    if ((c & 0xc0) == 0x80) { utf8_code = (utf8_code << 6) | (c & 0x3f); if (!--utf8_needed) { unsigned int codepoint = utf8_code; utf8_code = 0; if (codepoint >= (unsigned int)utf8_min && codepoint <= 0x10ffff && !in_range(codepoint, 0xd800, 0xdfff)) put_codepoint(codepoint); else advance_cell(); } return; }
    utf8_needed = utf8_code = utf8_min = 0; advance_cell(); put_byte(c); return;
  }
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
    else if (c == 's') { saved_x = x; saved_y = y; }
    else if (c == 'u') { x = saved_x; y = saved_y; }
    else if (c == 'J') clear_screen(); else if (c == 'K') while (x < width) screen[y][x++] = ' ';
    else if (c == 'h' || c == 'l') { if (count >= 1 && params[0] == 1049) clear_screen(); }
    if (x < 0) x = 0; if (y < 0) y = 0; if (x >= width) x = width - 1; if (y >= height) y = height - 1;
    esc = 0; return;
  }
  if (c == 27) { esc = 1; return; } if (c == '\\r') { x = 0; return; }
  if (c == '\\n') { if (++y >= height) y = height - 1; return; }
  if (c >= 0xc2 && c <= 0xdf) { utf8_code = c & 0x1f; utf8_needed = 1; utf8_min = 0x80; return; }
  if (c >= 0xe0 && c <= 0xef) { utf8_code = c & 0x0f; utf8_needed = 2; utf8_min = 0x800; return; }
  if (c >= 0xf0 && c <= 0xf4) { utf8_code = c & 0x07; utf8_needed = 3; utf8_min = 0x10000; return; }
  if (c >= 0x80) { advance_cell(); return; }
  if (c >= 32 && c < 127) { if (x < width && y < height) screen[y][x] = c; advance_cell(); }
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
  if (argc == 2 && !strcmp(argv[1], "--width-probe")) { int wide_column, wide_row, combining_column, combining_row; unsigned char wide1[] = { 0xe4 }, wide2[] = { 0xb8, 0xad, 'W', 'i', 'd', 'e', 'T', 'a', 'r', 'g', 'e', 't' }, combining1[] = { '\\r', '\\n', 'e', 0xcc }, combining2[] = { 0x81, 'C', 'o', 'm', 'b', 'i', 'n', 'i', 'n', 'g', 'T', 'a', 'r', 'g', 'e', 't' }; clear_screen(); for (size_t i = 0; i < sizeof wide1; i++) put_byte(wide1[i]); for (size_t i = 0; i < sizeof wide2; i++) put_byte(wide2[i]); for (size_t i = 0; i < sizeof combining1; i++) put_byte(combining1[i]); for (size_t i = 0; i < sizeof combining2; i++) put_byte(combining2[i]); if (!locate("WideTarget", &wide_column, &wide_row) || !locate("CombiningTarget", &combining_column, &combining_row) || wide_column != 3 || wide_row != 1 || combining_column != 2 || combining_row != 2) return 5; printf("wide=%d,%d combining=%d,%d\\n", wide_column, wide_row, combining_column, combining_row); return 0; }
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
