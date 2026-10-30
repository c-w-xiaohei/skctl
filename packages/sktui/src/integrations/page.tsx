import { createEffect, createSignal, For, Show } from "solid-js";
import type { Renderable } from "@opentui/core";
import { resolve } from "node:path";
import { Pane } from "../ui/pane";
import { DataList } from "../ui/data-list";
import { CommandControl } from "../command-control";
import { useTheme } from "../ui/use-theme";
import type { CommandRegistration, FocusOwner } from "../types";
import type { FocusRegistry } from "../focus";
import type { IntegrationsState } from "./state";

export function IntegrationsPage(props: {
  state: IntegrationsState;
  scope: "global" | "project";
  directory: string;
  registerCommand?: CommandRegistration;
  focusRegistry?: FocusRegistry;
}) {
  const tokens = useTheme();
  const [harness, setHarness] = createSignal<"codex" | "opencode">(
    props.state.target()?.environment.harness ?? "codex",
  );
  createEffect(() =>
    props.state.selectTarget({
      environment: { harness: harness() },
      scope:
        props.scope === "global"
          ? { kind: "global" }
          : { kind: "project", directory: resolve(props.directory) },
    }),
  );
  const inspection = props.state.inspection;
  const action = (
    name: "connect" | "disconnect" | "refresh" | "cancel" | "confirm" | "keep",
    label: string,
  ) => {
    const execute = () =>
      name === "confirm"
        ? void props.state.confirmDisconnect()
        : name === "keep"
          ? props.state.dismissConfirmation()
          : name === "refresh"
            ? void props.state.refresh()
            : name === "cancel"
              ? props.state.cancel()
              : void props.state.execute(name);
    const record = {
      id: `integration.${name}`,
      keys: ["enter", "return"],
      verb: label,
      get destination() {
        return harness();
      },
      scope: "page" as const,
      get enabled() {
        return name === "cancel"
          ? !!props.state.task()?.running
          : !props.state.task()?.running &&
              !props.state.loading() &&
              (!["confirm", "keep"].includes(name) || !!props.state.confirmation()) &&
              (name !== "disconnect" ||
                !!inspection()?.entries.some(
                  (entry) => entry.file === props.state.selected() && !entry.inherited,
                ));
      },
      disabledReason: name === "disconnect" ? "Select a local host entry to disconnect" : undefined,
      danger: name === "disconnect" || name === "confirm",
    };
    return (
      <CommandControl
        id={`integration-${name}`}
        record={record}
        execute={execute}
        register={(target: Renderable) => {
          const owner: FocusOwner = `command:integration.${name}`;
          const offFocus = props.focusRegistry?.register(owner, target);
          const offCommand = props.registerCommand?.(record, owner, target.id, execute);
          const offMode = props.focusRegistry?.registerModeHandler(target, (key) => {
            if (!["left", "right", "up", "down"].includes(key.name)) return "declined";
            const controls = [
              "connect",
              "disconnect",
              "refresh",
              "cancel",
              "keep",
              "confirm",
            ].flatMap((action) => {
              const control = props.focusRegistry?.target(`command:integration.${action}`) as
                | Renderable
                | undefined;
              return control && !control.isDestroyed && control.focusable ? [control] : [];
            });
            const index = controls.indexOf(target);
            controls[
              Math.max(
                0,
                Math.min(
                  controls.length - 1,
                  index + (["right", "down"].includes(key.name) ? 1 : -1),
                ),
              )
            ]?.focus();
            return "consumed";
          });
          return () => {
            offFocus?.();
            offCommand?.();
            offMode?.();
          };
        }}
      />
    );
  };
  return (
    <Pane id="integrations-page" title="Harness integrations" width="100%">
      <box flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
        <box id="integration-hosts-pane" flexDirection="column" flexShrink={0}>
          <DataList
            id="integration-hosts"
            height={3}
            focused={false}
            options={[
              { name: "Codex", description: "Native lifecycle hooks", value: "codex" },
              { name: "OpenCode", description: "V2 context plugin", value: "opencode" },
            ]}
            selectedIndex={harness() === "codex" ? 0 : 1}
            showDescription={false}
            ref={(target) => {
              const dispose = props.focusRegistry?.register("browser", target);
              target.once("destroyed", () => dispose?.());
            }}
            onChange={(index) => setHarness(index === 0 ? "codex" : "opencode")}
            onSelect={(index) => setHarness(index === 0 ? "codex" : "opencode")}
          />
        </box>
        <box
          id="integration-actions-pane"
          flexDirection="row"
          gap={1}
          flexWrap="wrap"
          flexShrink={0}
        >
          <Show
            when={!props.state.confirmation()}
            fallback={
              <>
                {action("keep", "Cancel")}
                {action("confirm", "Confirm disconnect")}
              </>
            }
          >
            {action("connect", "Connect / update")}
            {action("disconnect", "Disconnect")}
            {action("refresh", "Inspect")}
          </Show>
          <Show when={props.state.task()?.running}>{action("cancel", "Stop")}</Show>
        </box>
        <scrollbox id="integration-entries-pane" flexGrow={1} minHeight={0}>
          <Show when={props.state.task()}>
            {(task) => (
              <text>{`${task().target.environment.harness} · ${task().running ? "Working…" : (task().result?.outcome ?? "Failed")}`}</text>
            )}
          </Show>
          <Show when={props.state.confirmation()}>
            {(request) => (
              <box flexDirection="column" gap={1}>
                <text>{`Disconnect from ${request().entry?.file}?`}</text>
                <text>
                  Removes the skctl block for every reader of this file. Another instruction file
                  may become active. Other content is retained.
                </text>
              </box>
            )}
          </Show>
          <Show when={props.state.loading()}>
            <text>Inspecting host entries…</text>
          </Show>
          <Show when={props.state.problem()}>
            {(message) => <text fg={tokens().colors.warning}>{message()}</text>}
          </Show>
          <Show when={inspection()}>
            {(value) => (
              <box flexDirection="column" gap={1}>
                <text>{`${props.scope} · ${value().recommended ?? "Compatibility unknown"}\n${value().selectionReason}`}</text>
                <text
                  fg={tokens().colors.mutedForeground}
                >{`skctl: ${value().cli ?? "not found on this process PATH"}`}</text>
                <Show
                  when={value().entries.length}
                  fallback={<text>No existing entry found.</text>}
                >
                  <DataList
                    id="integration-entries"
                    height={Math.min(8, Math.max(2, value().entries.length * 2))}
                    ref={(target) => {
                      const dispose = props.focusRegistry?.register("integration-entries", target);
                      target.once("destroyed", () => dispose?.());
                    }}
                    options={value().entries.map((e) => ({
                      name: `${e.mechanism} · ${e.status}${e.inherited ? " · inherited" : ""}`,
                      description: e.file,
                      value: e.file,
                    }))}
                    selectedIndex={value().entries.findIndex(
                      (e) => e.file === props.state.selected(),
                    )}
                    showDescription
                    onChange={(index) => props.state.select(value().entries[index]?.file)}
                  />
                </Show>
                <For each={value().diagnostics}>
                  {(d) => (
                    <text
                      fg={tokens().colors.warning}
                    >{`${d.code}: ${d.message}${d.file ? `\n${d.file}` : ""}`}</text>
                  )}
                </For>
                <For each={value().nextSteps}>{(step) => <text>{step}</text>}</For>
              </box>
            )}
          </Show>
          <Show when={props.state.task()}>
            {(task) => (
              <box flexDirection="column" gap={1} marginTop={1}>
                <Show when={task().error}>
                  {(text) => <text fg={tokens().colors.warning}>{text()}</text>}
                </Show>
                <For each={task().result?.diagnostics ?? []}>
                  {(d) => <text>{`${d.code}: ${d.message}`}</text>}
                </For>
                <Show when={task().result?.file}>{(file) => <text>{file()}</text>}</Show>
              </box>
            )}
          </Show>
        </scrollbox>
      </box>
    </Pane>
  );
}
