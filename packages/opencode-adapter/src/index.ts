import type { Plugin } from "@opencode-ai/plugin";
import { AdapterProcessError, createProcessClient } from "./process.ts";
import { UNAVAILABLE_NOTICE, renderCatalog } from "./prompt.ts";

function report(_error: unknown): void {
  // Adapter failures are not part of the managed Skill interface.
  console.error("skill-cli managed catalog is unavailable");
}

const SkillCliOpenCodePlugin: Plugin = async (input) => {
  const client = createProcessClient();
  let reportedHostFailure = false;
  return {
    "experimental.chat.system.transform": async (_request, output) => {
      try {
        const catalog = await client.list(input.directory);
        output.system.push(renderCatalog(catalog.entries, catalog.references));
      } catch (error) {
        const isHostFailure = error instanceof AdapterProcessError && error.hostProbe;
        if (!isHostFailure || !reportedHostFailure) report(error);
        if (isHostFailure) reportedHostFailure = true;
        output.system.push(UNAVAILABLE_NOTICE);
      }
    },
  };
};

export default SkillCliOpenCodePlugin;
