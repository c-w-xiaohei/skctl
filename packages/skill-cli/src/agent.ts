import { SkillCliError, type SkillCliCore } from "@skill-cli/core";
import { createSkillCliCore } from "@skill-cli/core";
import { constants } from "node:os";
import { resolve } from "node:path";
import { renderAgentCatalog, unavailableCatalogPrompt } from "./agent-prompt";

const defaultSearchLimit = 10;
const help: Record<AgentOperation, string> = {
  browse:
    "Usage: skill-cli agent browse [collection-id]\nReturn a system-prompt-ready XML catalog. Root browse includes discovery and loading instructions; collection browse returns only its immediate Skills and child Collections. Use displayed collection IDs; selectors are not accepted.\n",
  search:
    "Usage: skill-cli agent search <query> [--limit <count>] [--in <collection-id>]\nSearch Use-root members only; References are not traversed. --in searches one reachable Collection. Default: 10 results; truncated:true means more matches exist.\n",
  load: "Usage: skill-cli agent load <selector>\nReturn the complete SKILL.md as text. Use a displayed Skill selector, not a collection ID.\n",
  read: "Usage: skill-cli agent read <selector> <root-relative-path>\nReturn one UTF-8 text resource. Paths are relative to the Skill Root; binary assets use download.\n",
  download:
    "Usage: skill-cli agent download <selector> <root-relative-path> --output <host-path> [--force]\nCopy one resource; return its absolute output path. --force replaces an existing regular file, never a symlink.\n",
  run: "Usage: skill-cli agent run <selector> -- <command> [args...]\nRun in a temporary copy of the Skill Root, deleted after exit. Write persistent outputs to absolute paths. Child output and exit status pass through. This is not a sandbox: commands may access the host and network.\n",
};

const agentHelp = `Usage: skill-cli [--project <path>] agent <command>\n\nCommands:\n  browse [collection-id]  Discover Collections or their immediate contents.\n  search <query>         Find Skill metadata (default: 10 results).\n  load <selector>        Read SKILL.md.\n  read <selector> <path> Read one text resource.\n  download <selector> <path> --output <path> [--force]\n  run <selector> -- <command> [args...]\n\nCollection IDs address browse; Skill selectors (<collection-id>:<entry-name>) address content. Use displayed addresses.\nBrowse/search/load/read use installed content without network acquisition. Run executes host commands; download writes the requested file.\nDetails: skill-cli agent <command> --help (or -h).\n`;

type AgentOperation = "browse" | "search" | "load" | "read" | "download" | "run";

export interface AgentCommandOptions {
  readonly cwd: string;
  readonly project?: string;
  readonly stdout?: { write(value: string): unknown };
  readonly stderr?: { write(value: string): unknown };
  readonly createCore?: (options: { cwd: string; project?: string }) => SkillCliCore;
}

interface ParsedAgentCommand {
  readonly operation: AgentOperation;
  readonly positional: readonly string[];
  readonly output?: string;
  readonly force: boolean;
  readonly limit?: number;
  readonly collection?: string;
  readonly child?: readonly [string, ...string[]];
}

const operations = new Set<AgentOperation>(["browse", "search", "load", "read", "download", "run"]);

function invalid(message: string): never {
  throw new SkillCliError("INVALID_ARGUMENT", message);
}

function validateCollectionId(value: string | undefined): void {
  if (!value || value.includes(":"))
    invalid(
      `Expected Collection ID, received ${value?.includes(":") ? "Skill Selector" : "invalid address"}`,
    );
}

function validateSkillSelector(value: string | undefined): void {
  if (!value || (value.match(/:/g) ?? []).length !== 1)
    invalid("Expected Skill Selector in <collection-id>:<entry-name> format");
}

function parseAgentCommand(argv: readonly string[]): ParsedAgentCommand {
  const operation = argv[0];
  if (!operation || !operations.has(operation as AgentOperation)) invalid("Unknown agent command");
  const op = operation as AgentOperation;
  const allowed = new Set<string>();
  if (op === "search") {
    allowed.add("--limit");
    allowed.add("--in");
  }
  if (op === "download") {
    allowed.add("--output");
    allowed.add("--force");
  }
  const seen = new Set<string>();
  const positional: string[] = [];
  let output: string | undefined;
  let limit: number | undefined;
  let force = false;
  let collection: string | undefined;
  let child: readonly [string, ...string[]] | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") {
      if (op !== "run") invalid("Child argv is only valid for run");
      const command = argv.slice(index + 1);
      if (!command.length) invalid("Selector and argv after -- are required");
      child = command as [string, ...string[]];
      break;
    }
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (!allowed.has(argument)) invalid(`Unknown or inapplicable option: ${argument}`);
    if (seen.has(argument)) invalid(`Duplicate option: ${argument}`);
    seen.add(argument);
    if (argument === "--force") {
      force = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) invalid(`Option requires a value: ${argument}`);
    if (argument === "--output") output = value;
    else if (argument === "--in") collection = value;
    else if (argument === "--limit") {
      limit = Number(value);
      if (!Number.isSafeInteger(limit) || limit < 1) invalid("--limit must be a positive integer");
    }
  }
  const expected = op === "read" || op === "download" ? 2 : 1;
  if (op === "browse") {
    if (positional.length > 1) invalid("Unexpected positional argument");
  } else if (positional.length !== expected) invalid("Unexpected positional argument");
  if (op === "download" && !output) invalid("--output is required for download");
  if (op === "run") {
    if (!child) invalid("Selector and argv after -- are required");
  }
  if (op === "browse" && positional[0]) validateCollectionId(positional[0]);
  if (op === "search" && collection) validateCollectionId(collection);
  if (op === "load" || op === "read" || op === "download" || op === "run")
    validateSkillSelector(positional[0]);
  return { operation: op, positional, output, force, limit, child, collection };
}

export async function runAgentCommand(
  argv: readonly string[],
  options: AgentCommandOptions,
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    if (!argv.length || (argv.length === 1 && ["--help", "-h"].includes(argv[0]!))) {
      stdout.write(agentHelp);
      return 0;
    }
    const separator = argv.indexOf("--");
    const ownArgs = separator === -1 ? argv : argv.slice(0, separator);
    if (
      operations.has(argv[0] as AgentOperation) &&
      ownArgs.slice(1).some((arg) => arg === "--help" || arg === "-h")
    ) {
      stdout.write(help[argv[0] as AgentOperation]);
      return 0;
    }
    const parsed = parseAgentCommand(argv);
    const core = (options.createCore ?? createSkillCliCore)({
      cwd: options.cwd,
      project: options.project,
    });
    const [selector, path] = parsed.positional;
    if (parsed.operation === "browse") {
      const result = await core.catalog.browse({ collection: selector });
      if (result.value.status === "unavailable") {
        stdout.write(`${unavailableCatalogPrompt}\n`);
        return 0;
      }
      stdout.write(renderAgentCatalog(result.value.scope, result.value.items));
    } else if (parsed.operation === "search") {
      const result = await core.catalog.search({
        query: selector!,
        limit: (parsed.limit ?? defaultSearchLimit) + 1,
        collection: parsed.collection,
      });
      stdout.write(
        `${JSON.stringify({
          results: result.value.results
            .slice(0, parsed.limit ?? defaultSearchLimit)
            .map(({ selector, name, description }) => ({
              selector,
              name,
              description,
            })),
          ...(result.value.results.length > (parsed.limit ?? defaultSearchLimit)
            ? { truncated: true }
            : {}),
        })}\n`,
      );
    } else if (parsed.operation === "load") {
      const result = await core.content.load({ selector: selector! });
      stdout.write(result.value.text);
    } else if (parsed.operation === "read") {
      const result = await core.content.read({ selector: selector!, path: path! });
      stdout.write(result.value.text);
    } else if (parsed.operation === "download") {
      const result = await core.content.download({
        selector: selector!,
        path: path!,
        output: resolve(options.cwd, parsed.output!),
        force: parsed.force,
      });
      stdout.write(`${JSON.stringify({ output: result.value.output })}\n`);
    } else {
      const controller = new AbortController();
      let interrupted: NodeJS.Signals | undefined;
      const signals: NodeJS.Signals[] =
        process.platform === "win32" ? ["SIGINT", "SIGTERM"] : ["SIGINT", "SIGTERM", "SIGHUP"];
      const handlers = signals.map((signal) => {
        const handler = () => {
          interrupted = signal;
          controller.abort();
        };
        process.on(signal, handler);
        return { signal, handler };
      });
      try {
        const result = await core.content.run(
          { selector: selector!, argv: parsed.child! },
          { signal: controller.signal },
        );
        const signal = interrupted ?? result.value.signal;
        return signal
          ? 128 + (constants.signals[signal as NodeJS.Signals] ?? 1)
          : (result.value.exitCode ?? 1);
      } finally {
        for (const { signal, handler } of handlers) process.removeListener(signal, handler);
      }
    }
    return 0;
  } catch (error) {
    const value =
      error instanceof SkillCliError ? error : new SkillCliError("INTERNAL", "Internal error");
    stderr.write(`${value.message}\n`);
    return 1;
  }
}
