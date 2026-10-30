import { createSignal, onCleanup } from "solid-js";
import * as api from "@skctl/integrations";

export type IntegrationsApi = Pick<typeof api, "inspect" | "connect" | "disconnect">;
export function createIntegrationsState(client: IntegrationsApi = api) {
  const [target, setTarget] = createSignal<api.IntegrationTarget>();
  const [inspection, setInspection] = createSignal<api.IntegrationInspection>();
  const [loading, setLoading] = createSignal(false);
  const [problem, setProblem] = createSignal<string>();
  const [selected, setSelected] = createSignal<string>();
  const [confirmation, setConfirmation] = createSignal<api.MutationRequest>();
  const [task, setTask] = createSignal<{
    target: api.IntegrationTarget;
    running: boolean;
    result?: api.IntegrationChange;
    error?: string;
  }>();
  let query: AbortController | undefined;
  let mutation: AbortController | undefined;
  let revision = 0;
  let closed = false;
  const key = (value: api.IntegrationTarget | undefined) => JSON.stringify(value);
  const refresh = async () => {
    const request = target();
    if (!request) return;
    setConfirmation(undefined);
    query?.abort();
    const controller = new AbortController();
    query = controller;
    const current = ++revision;
    setLoading(true);
    setProblem(undefined);
    try {
      const value = await client.inspect(request, { signal: controller.signal });
      if (closed || current !== revision) return;
      setInspection(value);
      setSelected((previous) =>
        value.entries.some((e) => e.file === previous)
          ? previous
          : value.entries.find((e) => !e.inherited)?.file,
      );
    } catch (error) {
      if (!closed && current === revision) setProblem(api.diagnostic(error).message);
    } finally {
      if (!closed && current === revision) setLoading(false);
    }
  };
  const selectTarget = (next: api.IntegrationTarget) => {
    if (key(next) === key(target())) return;
    query?.abort();
    revision++;
    setTarget(next);
    setInspection(undefined);
    setSelected(undefined);
    setConfirmation(undefined);
    setProblem(undefined);
    void refresh();
  };
  const run = async (action: "connect" | "disconnect", request: api.MutationRequest) => {
    if (task()?.running) return;
    setConfirmation(undefined);
    const controller = new AbortController();
    mutation = controller;
    setTask({ target: request.target, running: true });
    try {
      const result = await client[action](request, { signal: controller.signal });
      if (closed) return;
      setTask({ target: request.target, running: false, result });
      if (key(target()) === key(request.target)) {
        if (
          action === "disconnect" &&
          result.diagnostics.some((d) => d.code === "FILE_IMPACT_CONFIRMATION")
        ) {
          if (!controller.signal.aborted && selected() === request.entry?.file)
            setConfirmation(request);
        } else await refresh();
      }
    } catch (error) {
      if (!closed)
        setTask({ target: request.target, running: false, error: api.diagnostic(error).message });
    }
  };
  const execute = async (action: "connect" | "disconnect") => {
    const request = target();
    if (!request || loading()) return;
    const snapshot = inspection();
    const entry = snapshot?.entries.find((e) => e.file === selected() && !e.inherited);
    if (action === "disconnect" && !entry) return;
    await run(action, {
      target: request,
      entry: entry && { mechanism: entry.mechanism, file: entry.file },
      expected: snapshot?.revision,
      acknowledgeFileImpact: false,
    });
  };
  onCleanup(() => {
    closed = true;
    revision++;
    query?.abort();
    mutation?.abort();
  });
  return {
    target,
    inspection,
    loading,
    problem,
    selected,
    select: (file: string | undefined) => {
      if (file !== selected()) setConfirmation(undefined);
      setSelected(file);
    },
    confirmation,
    dismissConfirmation: () => setConfirmation(undefined),
    confirmDisconnect: async () => {
      const request = confirmation();
      if (request) await run("disconnect", { ...request, acknowledgeFileImpact: true });
    },
    task,
    refresh,
    selectTarget,
    execute,
    cancel: () => mutation?.abort(),
  };
}
export type IntegrationsState = ReturnType<typeof createIntegrationsState>;
