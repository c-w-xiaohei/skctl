import type { Plugin } from "@opencode-ai/plugin";
import { createProcessClient } from "./process.ts";

function report(_error: unknown): void {
  // Adapter failures are not part of the managed Skill interface.
  console.error("skctl managed catalog is unavailable");
}

const SkctlOpenCodePlugin: Plugin = async (input) => {
  const client = createProcessClient();
  let hasReportedFailure = false;
  const appendFreshCatalog = async (target: string[]) => {
    try {
      const prompt = await client.browse(input.directory);
      if (!target.includes(prompt)) target.push(prompt);
    } catch (error) {
      if (hasReportedFailure) return;
      report(error);
      hasReportedFailure = true;
    }
  };

  return {
    "experimental.chat.system.transform": async (_request, output) => {
      await appendFreshCatalog(output.system);
    },
    "experimental.session.compacting": async (_request, output) => {
      await appendFreshCatalog(output.context);
    },
  };
};

export default SkctlOpenCodePlugin;
