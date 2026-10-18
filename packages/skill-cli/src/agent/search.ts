import { type Command, InvalidArgumentError } from "commander";
import type { CommandContext } from "../command-context";
import { collectionId } from "./arguments";

function searchLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new InvalidArgumentError("--limit must be a positive integer");
  return limit;
}

export function searchCommand(parent: Command, { core, stdout }: CommandContext) {
  return parent
    .command("search <query>")
    .description(
      "Search Use-root members; References are not traversed. truncated:true means more matches exist.",
    )
    .option("--limit <count>", "Maximum number of results", searchLimit, 10)
    .option("--in <collection-id>", "Search one reachable Collection", collectionId)
    .action(async (query, flags, action) => {
      const { value } = await core(action).catalog.search({
        query,
        limit: flags.limit,
        collection: flags.in,
      });
      stdout.write(
        `${JSON.stringify({
          results: value.results,
          ...(value.truncated ? { truncated: true } : {}),
        })}\n`,
      );
    });
}
