import type { Plugin } from "@opencode-ai/plugin";
import { AdapterProcessError, createProcessClient, redactDiagnostic } from "./process.ts";
import { UNAVAILABLE_NOTICE, renderCatalog } from "./prompt.ts";

function report(error: unknown): void {
  const failure = error instanceof AdapterProcessError ? error : undefined;
  const code = failure?.code ?? "RENDER_FAILED";
  const status = failure?.status === undefined ? "unknown" : String(failure.status);
  const prefix = `skill-cli adapter ${code} status=${status} stderr=`;
  const stderr = redactDiagnostic(failure?.stderr ?? "", 4096 - Buffer.byteLength(prefix));
  // Diagnostics stay outside model content and contain only bounded sanitized child output.
  console.error(`${prefix}${stderr}`);
}

const SkillCliOpenCodePlugin: Plugin = async (input) => {
  const client = createProcessClient();
  let reportedHostFailure = false;
  return {
    "experimental.chat.system.transform": async (_request, output) => {
      try {
        output.system.push(renderCatalog(await client.list(input.directory)));
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
