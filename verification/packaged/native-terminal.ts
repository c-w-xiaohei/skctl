import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Parses native terminal output, never the in-memory test renderer. */
export class TerminalScreen {
  private cells: string[][] = [];
  private row = 0;
  private column = 0;
  private saved: [number, number] = [0, 0];
  private pending = "";
  private decoder = new TextDecoder();

  constructor(
    public width = 120,
    public height = 40,
  ) {
    this.clear();
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.clear();
  }

  private clear() {
    this.cells = Array.from({ length: this.height }, () => Array(this.width).fill(" "));
    this.row = this.column = 0;
  }

  feed(bytes: Uint8Array) {
    this.pending += this.decoder.decode(bytes, { stream: true });
    let index = 0;
    while (index < this.pending.length) {
      const value = this.pending[index]!;
      if (value === "\x1b") {
        if (index + 1 >= this.pending.length) break;
        const rest = this.pending.slice(index);
        if (rest.startsWith("\x1b[")) {
          // ANSI CSI sequences start with a literal terminal control character.
          // eslint-disable-next-line no-control-regex
          const match = /^\x1b\[([0-?]*)([ -/]*)([@-~])/.exec(rest);
          if (!match) break;
          const params = match[1]!.replace(/^\?/, "").split(/[;:]/).map(Number);
          const first = params[0] || 1;
          switch (match[3]) {
            case "H":
            case "f":
              this.row = first - 1;
              this.column = (params[1] || 1) - 1;
              break;
            case "A":
              this.row -= first;
              break;
            case "B":
              this.row += first;
              break;
            case "C":
              this.column += first;
              break;
            case "D":
              this.column -= first;
              break;
            case "G":
              this.column = first - 1;
              break;
            case "s":
              this.saved = [this.row, this.column];
              break;
            case "u":
              [this.row, this.column] = this.saved;
              break;
            case "J":
              if (params[0] === 2 || params[0] === 3) this.clear();
              break;
            case "K": {
              const start = params[0] === 2 || params[0] === 1 ? 0 : this.column;
              const end = params[0] === 1 ? this.column + 1 : this.width;
              this.cells[this.row]?.fill(" ", start, end);
              break;
            }
            case "h":
            case "l":
              if (params[0] === 1049) this.clear();
              break;
          }
          this.row = Math.max(0, Math.min(this.height - 1, this.row));
          this.column = Math.max(0, Math.min(this.width - 1, this.column));
          index += match[0].length;
          continue;
        }
        if (rest.startsWith("\x1b]")) {
          // OSC terminates with BEL or the ESC-backslash string terminator.
          // eslint-disable-next-line no-control-regex
          const end = /\x07|\x1b\\/.exec(rest);
          if (!end) break;
          index += end.index + end[0].length;
          continue;
        }
        // The remaining ANSI escape families also begin with ESC.
        // eslint-disable-next-line no-control-regex
        const match = /^\x1b[ -/]*[0-~]/.exec(rest);
        if (!match) break;
        index += match[0].length;
        continue;
      }
      const character = String.fromCodePoint(this.pending.codePointAt(index)!);
      index += character.length;
      if (character === "\r") this.column = 0;
      else if (character === "\n") this.row = Math.min(this.height - 1, this.row + 1);
      else if (character === "\b") this.column = Math.max(0, this.column - 1);
      else if (character >= " ") {
        const width = Bun.stringWidth(character);
        if (width === 0) {
          this.cells[this.row]![Math.max(0, this.column - 1)] += character;
          continue;
        }
        const wide = width === 2;
        this.cells[this.row]![this.column] = character;
        if (wide && this.column + 1 < this.width) this.cells[this.row]![this.column + 1] = "";
        this.column += wide ? 2 : 1;
        if (this.column >= this.width) {
          this.column = 0;
          this.row = Math.min(this.height - 1, this.row + 1);
        }
      }
    }
    this.pending = this.pending.slice(index);
  }

  text() {
    return this.cells.map((row) => row.join("").trimEnd()).join("\n");
  }

  locate(label: string, targetRow?: number) {
    for (
      let row = targetRow === undefined ? this.height - 1 : targetRow - 1;
      row >= (targetRow === undefined ? 0 : targetRow - 1);
      row--
    ) {
      const text = this.cells[row]!.join("");
      const index = text.lastIndexOf(label);
      if (index < 0) continue;
      let offset = 0;
      for (let column = 0; column < this.width; column++) {
        if (this.cells[row]![column] === "") continue;
        if (offset === index) return { column: column + 1, row: row + 1 };
        offset += this.cells[row]![column]!.length;
      }
    }
    return undefined;
  }
}

export function shellSelectionInvariants(text: string) {
  const lines = text.split("\n");
  if (!lines[0]?.includes("skctl")) return { resizeOrModal: true };
  // Compact headers can clip the closing bracket; the opening bracket and exact
  // canonical token still identify selection, never bare unselected context text.
  const selectedContextCount = [
    ...lines[0].matchAll(/\[\s*(Workspace|Global|Project|Local)(?=\s|\]|$)/g),
  ].length;
  const sections = "Skills|Sources|Config Sources|Collections|Integrations|Updates";
  const sidebarMounted = lines.slice(2, 12).some((line) => /^\s*PAGES\s*│/.test(line));
  // Current tabs use background color, not punctuation. This text-only screen
  // cannot attest to color selection; retain strict checks for older textual
  // cues and the still-textual sidebar, without inventing selected counts.
  const tabCues = `${lines[0]} ${sidebarMounted ? "" : (lines[2] ?? "")}`;
  const colorOnly = !tabCues.includes("[") && !tabCues.includes("]");
  const selectedSectionCount = sidebarMounted
    ? lines.slice(2, -3).filter((line) => {
        const separator = line.indexOf("│");
        return (
          separator >= 0 &&
          separator <= 22 &&
          new RegExp(`^\\s*▶\\s*(${sections})\\s*$`).test(line.slice(0, separator))
        );
      }).length
    : [...(lines[2] ?? "").matchAll(new RegExp(`\\[\\s*(${sections})\\s*\\]`, "g"))].length;
  return {
    selectedContextCount: colorOnly ? null : selectedContextCount,
    selectedSectionCount: colorOnly && !sidebarMounted ? null : selectedSectionCount,
    sectionCue: sidebarMounted ? "sidebar" : "compact-navigation",
    ...(colorOnly ? { tabSelectionEvidence: "unavailable-in-text" as const } : {}),
  };
}

export async function nativeTerminal(
  artifact: string,
  cwd: string,
  environment: Record<string, string>,
  output: string,
  journeyName: string,
  journey: (driver: NativeDriver) => Promise<void>,
  args: readonly string[] = [],
  terminationSignal?: NodeJS.Signals,
) {
  const binarySha256 = new Bun.CryptoHasher("sha256")
    .update(await readFile(artifact))
    .digest("hex");
  const screen = new TerminalScreen();
  const chunks: Uint8Array[] = [];
  const events: object[] = [];
  let updated = 0;
  let exited = false;
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    name: "xterm-256color",
    data(_terminal, bytes) {
      chunks.push(bytes.slice());
      screen.feed(bytes);
      updated = Date.now();
    },
  });
  const child = Bun.spawn([artifact, ...args], {
    cwd,
    env: { ...environment, TERM: "xterm-256color", TERM_PROGRAM: "" },
    terminal,
  });
  void child.exited.then(() => {
    exited = true;
  });
  const wait = async (predicate: () => boolean, description: string) => {
    const deadline = Date.now() + 8000;
    while (!exited && Date.now() < deadline) {
      if (updated && Date.now() - updated >= 80 && predicate()) return;
      await Bun.sleep(10);
    }
    throw new Error(`Native terminal ${description}\n${screen.text()}`);
  };
  const driver: NativeDriver = {
    text: () => screen.text(),
    async frame(name, required) {
      await wait(
        () => required.every((value) => screen.text().includes(value)),
        `checkpoint ${name} missing ${required.join(", ")}`,
      );
      const invariants = shellSelectionInvariants(screen.text());
      if (
        "selectedContextCount" in invariants &&
        ((invariants.selectedContextCount !== null && invariants.selectedContextCount !== 1) ||
          (invariants.selectedSectionCount !== null && invariants.selectedSectionCount !== 1))
      )
        throw new Error(`Native shell selection invariant failed at ${name}\n${screen.text()}`);
      const file = join(
        output,
        "frames",
        `${screen.width}x${screen.height}`,
        journeyName,
        `${name}.txt`,
      );
      await mkdir(join(output, "frames", `${screen.width}x${screen.height}`, journeyName), {
        recursive: true,
      });
      await writeFile(file, screen.text() + "\n");
      events.push({
        type: "checkpoint",
        name,
        width: screen.width,
        height: screen.height,
        required,
        passed: true,
        binarySha256,
        invariants,
        frame: file,
      });
    },
    async key(bytes) {
      events.push({ type: "input", bytes });
      updated = Date.now();
      terminal.write(bytes);
      await wait(() => true, `input ${JSON.stringify(bytes)}`);
    },
    async click(label, row) {
      await wait(() => !!screen.locate(label, row), `click target ${label}`);
      const point = screen.locate(label, row)!;
      events.push({ type: "click", label, ...point });
      updated = Date.now();
      terminal.write(`\x1b[<0;${point.column};${point.row}M\x1b[<0;${point.column};${point.row}m`);
      await wait(() => true, `click ${label}`);
    },
    async resize(width, height) {
      events.push({ type: "resize", width, height });
      updated = Date.now();
      screen.resize(width, height);
      terminal.resize(width, height);
      child.kill("SIGWINCH");
      await wait(() => true, `resize ${width}x${height}`);
    },
  };
  let failure: unknown;
  try {
    await wait(() => screen.text().includes("skctl"), "startup");
    await journey(driver);
    if (terminationSignal) child.kill(terminationSignal);
    else terminal.write("\x03");
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(8000).then(() => {
        throw new Error("Native terminal did not exit on termination");
      }),
    ]);
    const expected =
      terminationSignal === "SIGTERM" ? 143 : terminationSignal === "SIGHUP" ? 129 : 130;
    if (exitCode !== 0 && exitCode !== expected)
      throw new Error(`Native terminal exited ${exitCode}`);
    if (terminationSignal && exitCode === 0)
      throw new Error("Signal termination incorrectly reported success");
    events.push({ type: "exit", exitCode, binarySha256 });
  } catch (error) {
    failure = error;
  } finally {
    if (!exited) {
      child.kill();
      await child.exited;
    }
    terminal.close();
    await mkdir(join(output, "transcripts"), { recursive: true });
    await writeFile(join(output, "transcripts", `${journeyName}.ansi`), Buffer.concat(chunks));
    await writeFile(
      join(output, "transcripts", `${journeyName}.ndjson`),
      events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    );
    if (failure)
      await writeFile(join(output, "transcripts", `${journeyName}-failure.txt`), String(failure));
  }
  if (failure) throw failure;
  const bytes = await readFile(join(output, "transcripts", `${journeyName}.ansi`), "utf8");
  if (!bytes.includes("\x1b[?1049h") || !bytes.includes("\x1b[?1049l"))
    throw new Error("Native terminal did not restore its alternate screen");
}

export interface NativeDriver {
  text(): string;
  frame(name: string, required: readonly string[]): Promise<void>;
  key(bytes: string): Promise<void>;
  click(label: string, row?: number): Promise<void>;
  resize(width: number, height: number): Promise<void>;
}
