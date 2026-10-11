import { SkillCliError, type SkillCliCore } from "@skill-cli/core";
import { createSkillCliCore } from "@skill-cli/core";
import { renderAgentCatalog, unavailableCatalogPrompt } from "./agent-prompt";

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
const values = new Set(["--limit", "--output", "--in"]);

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
    if (!values.has(argument)) invalid(`Unknown option: ${argument}`);
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
  } else if (child) invalid("Child argv is only valid for run");
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
    if (argv.length === 1 && argv[0] === "--help") {
      stdout.write(
        `skill-cli agent exposes installed managed Skills without network access or configuration changes.\n\nBrowse returns collection nodes or Skill nodes. A collection ID is a slash-qualified name from browse; a Skill Selector is <collection-id>:<entry-name> from a Skill node.\n\nUse collection nodes with: skill-cli agent browse <collection-id>\nUse Skill nodes with: skill-cli agent load <selector>, read, download, or run.\n\nWorkflow:\n  skill-cli agent browse\n  skill-cli agent browse engineering\n  skill-cli agent load engineering:review\n  skill-cli agent read engineering:review references/checklist.md\n\nCommands:\n  browse [collection-id]  Browse Use roots, or one reachable collection. Collection IDs come from collection nodes; selectors are not accepted.\n  search <query> [--in <collection-id>]  Search disclosed Skills. --in accepts a reachable collection ID and does not traverse References.\n  load <selector>  Load SKILL.md for a disclosed Skill Selector; collection IDs are not accepted.\n  read <selector> <path>  Read a root-relative resource for a disclosed Skill Selector.\n  download <selector> <path> --output <path>  Download a resource for a disclosed Skill Selector.\n  run <selector> -- <command> [args...]  Run a command with a disclosed Skill Selector.\n`,
      );
      return 0;
    }
    if (argv.length === 2 && argv[1] === "--help" && operations.has(argv[0] as AgentOperation)) {
      const help: Record<AgentOperation, string> = {
        browse:
          "Usage: skill-cli agent browse [collection-id]\nBrowse Use roots or one Reference-reachable collection. collection-id comes from a collection node; Skill Selectors are not accepted.\n",
        search:
          "Usage: skill-cli agent search <query> [--limit <count>] [--in <collection-id>]\nSearch disclosed Skills. --in accepts a browse collection ID and does not traverse References; Skill Selectors are not accepted.\n",
        load: "Usage: skill-cli agent load <selector>\nLoad SKILL.md for a disclosed Skill Selector from a Skill node. Collection IDs are not accepted.\n",
        read: "Usage: skill-cli agent read <selector> <root-relative-path>\nRead a resource for a disclosed Skill Selector from a Skill node. Collection IDs are not accepted.\n",
        download:
          "Usage: skill-cli agent download <selector> <root-relative-path> --output <host-path>\nDownload a resource for a disclosed Skill Selector from a Skill node. Collection IDs are not accepted.\n",
        run: "Usage: skill-cli agent run <selector> -- <command> [args...]\nRun a command with a disclosed Skill Selector from a Skill node. Collection IDs are not accepted.\n",
      };
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
        limit: parsed.limit,
        collection: parsed.collection,
      });
      stdout.write(
        `${JSON.stringify({
          query: result.value.query,
          results: result.value.results.map(({ kind, rank, selector, name, description }) => ({
            kind,
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
