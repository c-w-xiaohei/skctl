import type { Plugin } from "@opencode-ai/plugin";
import { createProcessClient } from "./process.ts";

function report(_error: unknown): void {
  // Adapter failures are not part of the managed Skill interface.
  console.error("skill-cli managed catalog is unavailable");
}

const SkillCliOpenCodePlugin: Plugin = async (input) => {
  const client = createProcessClient();
  let reportedFailure = false;
  return {
    "experimental.chat.system.transform": async (_request, output) => {
      try {
        output.system.push(await client.browse(input.directory));
      } catch (error) {
        if (!reportedFailure) report(error);
        reportedFailure = true;
      }
    },
  };
};

export default SkillCliOpenCodePlugin;
