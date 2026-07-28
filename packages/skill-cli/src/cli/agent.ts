import { SkillCliError, type SkillCliCore } from "../core/api";
import { createSkillCliCore } from "../core/create-core";

type AgentOperation = "list" | "search" | "load" | "read" | "download" | "run";

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
  readonly child?: readonly [string, ...string[]];
}

const operations = new Set<AgentOperation>(["list", "search", "load", "read", "download", "run"]);
const values = new Set(["--limit", "--output"]);

function invalid(message: string): never {
  throw new SkillCliError("INVALID_ARGUMENT", message);
}

function parseAgentCommand(argv: readonly string[]): ParsedAgentCommand {
  const operation = argv[0];
  if (!operation || !operations.has(operation as AgentOperation)) invalid("Unknown agent command");
  const op = operation as AgentOperation;
  const allowed = new Set<string>();
  if (op === "search") allowed.add("--limit");
  if (op === "download") {
    allowed.add("--output");
    allowed.add("--force");
  }
  const seen = new Set<string>();
  const positional: string[] = [];
  let output: string | undefined;
  let limit: number | undefined;
  let force = false;
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
    if (!values.has(argument)) invalid(`Unknown option: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) invalid(`Option requires a value: ${argument}`);
    if (argument === "--output") output = value;
    else if (argument === "--limit") {
      limit = Number(value);
      if (!Number.isSafeInteger(limit) || limit < 1) invalid("--limit must be a positive integer");
    }
  }
  const expected = op === "read" || op === "download" ? 2 : 1;
  if (op === "list") {
    if (positional.length > 1) invalid("Unexpected positional argument");
  } else if (positional.length !== expected) invalid("Unexpected positional argument");
  if (op === "download" && !output) invalid("--output is required for download");
  if (op === "run") {
    if (!child) invalid("Selector and argv after -- are required");
  } else if (child) invalid("Child argv is only valid for run");
  return { operation: op, positional, output, force, limit, child };
}

export async function runAgentCommand(
  argv: readonly string[],
  options: AgentCommandOptions,
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const parsed = parseAgentCommand(argv);
    const core = (options.createCore ?? createSkillCliCore)({
      cwd: options.cwd,
      project: options.project,
    });
    const [selector, path] = parsed.positional;
    if (parsed.operation === "list") {
      const result = await core.catalog.list({ collection: selector });
      if (result.value.status === "unavailable") {
        stdout.write(`${JSON.stringify({ unavailable: true })}\n`);
        return 0;
      }
      stdout.write(
        `${JSON.stringify({
          skills: result.value.catalog.map(({ selector, name, description }) => ({
            selector,
            name,
            description,
          })),
          references: result.value.references ?? [],
        })}\n`,
      );
    } else if (parsed.operation === "search") {
      const result = await core.catalog.search({ query: selector!, limit: parsed.limit });
      stdout.write(
        `${JSON.stringify({
          query: result.value.query,
          results: result.value.results.map(({ rank, selector, name, description }) => ({
            rank,
            selector,
            name,
            description,
          })),
        })}\n`,
      );
    } else if (parsed.operation === "load") {
      const result = await core.content.load({ selector: selector! });
      const { selector: loadedSelector, name, description, path: loadedPath, text } = result.value;
      stdout.write(
        `${JSON.stringify({ selector: loadedSelector, name, description, path: loadedPath, text })}\n`,
      );
    } else if (parsed.operation === "read") {
      const result = await core.content.read({ selector: selector!, path: path! });
      const { selector: readSelector, path: readPath, text } = result.value;
      stdout.write(`${JSON.stringify({ selector: readSelector, path: readPath, text })}\n`);
    } else if (parsed.operation === "download") {
      const result = await core.content.download({
        selector: selector!,
        path: path!,
        output: parsed.output!,
        force: parsed.force,
      });
      const {
        selector: downloadedSelector,
        path: downloadedPath,
        output,
        bytesWritten,
      } = result.value;
      stdout.write(
        `${JSON.stringify({ selector: downloadedSelector, path: downloadedPath, output, bytesWritten })}\n`,
      );
    } else {
      const result = await core.content.run({ selector: selector!, argv: parsed.child! });
      stdout.write(`${JSON.stringify(result.value)}\n`);
    }
    return 0;
  } catch (error) {
    const value =
      error instanceof SkillCliError ? error : new SkillCliError("INTERNAL", "Internal error");
    stderr.write(`${value.message}\n`);
    return 1;
  }
}
