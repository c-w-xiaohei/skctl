import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { useRenderer } from "@opentui/solid";
import type { Renderable } from "@opentui/core";
import { resolve } from "node:path";
import { Pane } from "../ui/pane";
import { DataList } from "../ui/data-list";
import { CommandControl } from "../command-control";
import { useTheme } from "../ui/use-theme";
import type { CommandRegistration, FocusOwner } from "../types";
import type { FocusRegistry } from "../focus";
import type { IntegrationsState } from "./state";
import type { IntegrationTarget } from "@skctl/integrations";
import { usePageReturn } from "../page-navigation";
import { ObjectMenu } from "../object-menu";

export function IntegrationsPage(props: {
  state: IntegrationsState;
  scope: "global" | "project";
  directory: string;
  wide: boolean;
  browserWidth: number;
  registerCommand?: CommandRegistration;
  focusRegistry?: FocusRegistry;
}) {
  const tokens = useTheme();
  const renderer = useRenderer();
  const terminal = useTerminalSize();
  const entered = props.state.entered;
  const [object, setObject] = createSignal<Renderable>();
  const enter = () => {
    props.state.setEntered(true);
    queueMicrotask(() =>
      renderer.root
        .findDescendantById(
          props.state.confirmation()
            ? "integration-keep"
            : props.state.task()?.running
              ? "integration-cancel"
              : "integration-connect",
        )
        ?.focus(),
    );
  };
  const back = () => {
    props.state.setEntered(false);
    queueMicrotask(() => renderer.root.findDescendantById("integration-hosts")?.focus());
  };
  const backRecord = {
    id: "integration.back",
    keys: ["escape"],
    verb: "Back to hosts",
    destination: "Hosts",
    scope: "page" as const,
    enabled: true,
    danger: false,
  };
  const sharedReturn = usePageReturn(() =>
    entered() ? { record: backRecord, anchor: object, execute: back } : undefined,
  );
  const [harness, setHarness] = createSignal<"codex" | "opencode">(
    props.state.target()?.environment.harness ?? "codex",
  );
  createEffect(() => {
    const target = {
      environment: { harness: harness() },
      scope:
        props.scope === "global"
          ? { kind: "global" as const }
          : { kind: "project" as const, directory: resolve(props.directory) },
    };
    untrack(() => props.state.selectTarget(target));
  });
  const inspection = props.state.inspection;
  const describeTarget = (target: IntegrationTarget | undefined) =>
    target
      ? `${target.environment.harness} (${target.scope.kind})${target.scope.kind === "project" ? ` ${target.scope.directory}` : ""}`
      : "Host";
  const command = (
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
        const captured = name === "cancel" ? props.state.task() : props.state.confirmation();
        const file = captured
          ? captured.entry?.file
          : name === "refresh"
            ? undefined
            : props.state.selected();
        return `${describeTarget(captured?.target ?? props.state.target())}${file ? `: ${file}` : ""}`;
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
      get disabledReason() {
        if (props.state.task()?.running) return "A connection task is running";
        if (props.state.loading()) return "Inspecting host entries";
        return name === "disconnect" ? "Select a local host entry to disconnect" : undefined;
      },
      danger: name === "disconnect" || name === "confirm",
    };
    return { record, execute };
  };
  const action = (name: Parameters<typeof command>[0], label: string) => {
    const { record, execute } = command(name, label);
    return (
      <CommandControl
        id={`integration-${name}`}
        record={record}
        showDisabledReason={false}
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
              "more",
              "cancel",
              "keep",
              "confirm",
            ].flatMap((action) => {
              const control = props.focusRegistry?.target(
                action === "more"
                  ? "command:integration-more.open"
                  : `command:integration.${action}`,
              ) as Renderable | undefined;
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
    <box id="integrations-page" width="100%" flexDirection="row" gap={1} flexGrow={1} minHeight={0}>
      <Show when={props.wide || !entered()}>
        <box width={props.wide ? props.browserWidth : "100%"} flexShrink={0} minHeight={0}>
          <Pane id="integration-hosts-pane" title="Hosts">
            <DataList
              id="integration-hosts"
              marginTop={terminal().height >= 24 ? 1 : 0}
              flexGrow={1}
              focused={false}
              options={[
                { name: "Codex", description: "Native lifecycle hooks", value: "codex" },
                { name: "OpenCode", description: "V2 context plugin", value: "opencode" },
              ]}
              selectedIndex={harness() === "codex" ? 0 : 1}
              showDescription={false}
              ref={(target) => {
                const dispose = props.focusRegistry?.register("browser", target);
                const offMode = props.focusRegistry?.registerModeHandler(target, (key) => {
                  if (key.name !== "tab" || key.shift || key.ctrl || key.meta || key.alt)
                    return "declined";
                  enter();
                  return "consumed";
                });
                target.once("destroyed", () => {
                  dispose?.();
                  offMode?.();
                });
              }}
              onChange={(index) => setHarness(index === 0 ? "codex" : "opencode")}
              onSelect={() => enter()}
            />
          </Pane>
        </box>
      </Show>
      <Show when={props.wide || entered()}>
        <box flexGrow={1} flexBasis={0} minWidth={0} minHeight={0} ref={setObject}>
          <Pane id="integration-object-pane" title={harness() === "codex" ? "Codex" : "OpenCode"}>
            <Show when={!sharedReturn && entered()}>
              <CommandControl id="integration-back" record={backRecord} execute={back} />
            </Show>
            <box
              id="integration-actions-pane"
              marginBottom={terminal().height >= 24 ? 1 : 0}
              flexDirection="row"
              height={1}
              flexShrink={0}
              gap={1}
            >
              <Show
                when={!props.state.confirmation()}
                fallback={
                  <>
                    {action("keep", "Keep")}
                    {action("confirm", "Confirm disconnect")}
                  </>
                }
              >
                <Show when={!props.state.task()?.running} fallback={action("cancel", "Stop")}>
                  {action("connect", "Connect")}
                  {action("disconnect", "Disconnect")}
                  <ObjectMenu
                    id="integration-more"
                    target={`${describeTarget(props.state.target())}:${props.state.selected() ?? ""}`}
                    commands={[command("refresh", "Refresh")]}
                    focusRegistry={props.focusRegistry}
                    registerCommand={props.registerCommand}
                  />
                </Show>
              </Show>
            </box>
            <scrollbox id="integration-entries-pane" flexGrow={1} minHeight={0}>
              <Show when={!props.state.confirmation() && props.state.task()}>
                {(task) => (
                  <box id="integration-task" flexDirection="column" flexShrink={0}>
                    <text>{`Task: ${describeTarget(task().target)}`}</text>
                    <Show when={task().entry?.file}>{(file) => <text>{file()}</text>}</Show>
                    <text>
                      {task().running ? "Working…" : (task().result?.outcome ?? "Failed")}
                    </text>
                    <Show when={task().error}>
                      {(text) => <text fg={tokens().colors.warning}>{text()}</text>}
                    </Show>
                    <For each={task().result?.diagnostics ?? []}>
                      {(d) => <text>{`${d.code}: ${d.message}`}</text>}
                    </For>
                    <Show when={task().result?.file && task().result?.file !== task().entry?.file}>
                      {(file) => <text>{file()}</text>}
                    </Show>
                  </box>
                )}
              </Show>
              <Show when={props.state.confirmation()}>
                {(request) => (
                  <box flexDirection="column">
                    <text>{`Disconnect from ${request().entry?.file}?`}</text>
                    <text>
                      Removes the skctl block for every reader of this file. Another instruction
                      file may become active. Other content is retained.
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
              <Show when={!props.state.confirmation() && inspection()}>
                {(value) => (
                  <box flexDirection="column" gap={1}>
                    <text>{`${props.scope}\n${value().recommended ?? "Compatibility unknown"}\n${value().selectionReason}`}</text>
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
                          const dispose = props.focusRegistry?.register(
                            "integration-entries",
                            target,
                          );
                          target.once("destroyed", () => dispose?.());
                        }}
                        options={value().entries.map((e) => ({
                          name: `${e.mechanism}: ${e.status}${e.inherited ? " (inherited)" : ""}`,
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
            </scrollbox>
          </Pane>
        </box>
      </Show>
    </box>
  );
}
import { useTerminalSize } from "../ui/terminal-size";
