import { SkillCliError, type SkillCliCore } from "../core/api";
import { createSkillCliCore } from "../core/create-core";
import { jsonError, jsonSuccess, jsonUnavailable, type AgentOperation } from "./protocol-v1";

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
const values = new Set(["--protocol", "--agent", "--agent-version", "--limit", "--output"]);

function invalid(message: string): never {
  throw new SkillCliError("INVALID_ARGUMENT", message);
}

function parseAgentCommand(argv: readonly string[]): ParsedAgentCommand {
  const operation = argv[0];
  if (!operation || !operations.has(operation as AgentOperation)) invalid("Unknown agent command");
  const op = operation as AgentOperation;
  const allowed = new Set(["--json", "--protocol", "--agent", "--agent-version"]);
  if (op === "search") allowed.add("--limit");
  if (op === "download") {
    allowed.add("--output");
    allowed.add("--force");
  }
  const seen = new Set<string>();
  const positional: string[] = [];
  let protocol: string | undefined;
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
    if (argument === "--json") continue;
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (!values.has(argument)) invalid(`Unknown option: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) invalid(`Option requires a value: ${argument}`);
    if (argument === "--protocol") protocol = value;
    else if (argument === "--output") output = value;
    else if (argument === "--limit") {
      limit = Number(value);
      if (!Number.isSafeInteger(limit) || limit < 1) invalid("--limit must be a positive integer");
    }
  }
  if (!seen.has("--json") || protocol !== "1")
    throw new SkillCliError("PROTOCOL_MISMATCH", "Agent protocol v1 with --json is required");
  const expected = op === "list" ? 0 : op === "read" || op === "download" ? 2 : 1;
  if (positional.length !== expected) invalid("Unexpected positional argument");
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
  const operation = operations.has(argv[0] as AgentOperation)
    ? (argv[0] as AgentOperation)
    : undefined;
  const json = argv.includes("--json");
  try {
    const parsed = parseAgentCommand(argv);
    const core = (options.createCore ?? createSkillCliCore)({
      cwd: options.cwd,
      project: options.project,
    });
    const [selector, path] = parsed.positional;
    if (parsed.operation === "list") {
      const result = await core.catalog.list({});
      if (result.value.status === "unavailable") {
        stdout.write(
          jsonUnavailable(parsed.operation, result.value.reason ?? "Catalog unavailable"),
        );
        return 0;
      }
      stdout.write(
        jsonSuccess(parsed.operation, {
          agent: { id: "opencode", version: process.env.SKILL_CLI_AGENT_VERSION ?? "" },
          mode: "managed",
          entries: result.value.catalog,
        }),
      );
    } else if (parsed.operation === "search") {
      const result = await core.catalog.search({ query: selector!, limit: parsed.limit });
      stdout.write(jsonSuccess(parsed.operation, result.value));
    } else if (parsed.operation === "load") {
      const result = await core.content.load({ selector: selector! });
      stdout.write(jsonSuccess(parsed.operation, result.value));
    } else if (parsed.operation === "read") {
      const result = await core.content.read({ selector: selector!, path: path! });
      stdout.write(jsonSuccess(parsed.operation, result.value));
    } else if (parsed.operation === "download") {
      const result = await core.content.download({
        selector: selector!,
        path: path!,
        output: parsed.output!,
        force: parsed.force,
      });
      stdout.write(jsonSuccess(parsed.operation, result.value));
    } else {
      const result = await core.content.run({ selector: selector!, argv: parsed.child! });
      stdout.write(jsonSuccess(parsed.operation, result.value));
    }
    return 0;
  } catch (error) {
    const value =
      error instanceof SkillCliError ? error : new SkillCliError("INTERNAL", "Internal error");
    if (json && operation)
      stdout.write(jsonError(operation, value.code, value.message, value.diagnostics));
    stderr.write(`${value.code}: ${value.message}\n`);
    return 1;
  }
}
