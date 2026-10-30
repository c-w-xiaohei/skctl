import type { Plugin } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import { createProcessClient } from "./process.ts";

function report(_error: unknown): void {
  // Adapter failures are not part of the managed Skill interface.
  console.error("skctl managed catalog is unavailable");
}

const SkctlOpenCodePlugin = {
  id: "skctl.managed-catalog",
  async setup(input: Plugin.Context) {
    const controller = new AbortController();
    const client = createProcessClient({ signal: controller.signal, timeoutMs: 30_000 });
    let hasReportedFailure = false;
    const appendFreshCatalog = async (event: SessionContext) => {
      try {
        const session = await input.session.get({ sessionID: event.sessionID });
        if (controller.signal.aborted) return;
        const prompt = await client.browse(session.location.directory);
        if (
          !controller.signal.aborted &&
          !event.system.some((part) => part.type === "text" && part.text === prompt)
        )
          event.system.push({ type: "text", text: prompt });
      } catch (error) {
        if (hasReportedFailure) return;
        report(error);
        hasReportedFailure = true;
      }
    };

    await input.session.hook("context", appendFreshCatalog);
    await input.session.hook("compaction", appendFreshCatalog);
    return () => controller.abort();
  },
} satisfies Plugin.Plugin;

export default SkctlOpenCodePlugin;
