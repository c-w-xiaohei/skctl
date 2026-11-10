import { For, Show, createSignal } from "solid-js";
import type { BoxRenderable } from "@opentui/core";
import type { FocusRegistry } from "../focus";
import { CommandControl } from "../command-control";
import { useTheme } from "./use-theme";

export interface Breadcrumb {
  readonly label: string;
  readonly select?: () => void;
}

/** One bounded path across the workspace; ancestors navigate, the current item is text. */
export function Breadcrumbs(props: {
  readonly items: readonly Breadcrumb[];
  readonly focusRegistry: FocusRegistry;
}) {
  const tokens = useTheme();
  const [width, setWidth] = createSignal(0);
  let row: BoxRenderable | undefined;
  const compact = () =>
    props.items.reduce((sum, item) => sum + Bun.stringWidth(item.label) + 4, 0) > width();
  const visible = () =>
    compact() && props.items.length > 2
      ? [props.items[0]!, { label: "…" }, props.items.at(-1)!]
      : props.items;
  return (
    <box
      id="workspace-breadcrumbs"
      flexDirection="row"
      height={1}
      minWidth={0}
      flexGrow={1}
      ref={(target: BoxRenderable) => {
        row = target;
        setWidth(target.width);
      }}
      onSizeChange={() => setWidth(row?.width ?? 0)}
    >
      <For each={visible()}>
        {(item, index) => (
          <>
            <Show when={index() > 0}>
              <text flexShrink={0} fg={tokens().colors.mutedForeground}>
                {" "}
                ›{" "}
              </text>
            </Show>
            <Show
              when={item.select}
              fallback={
                <text
                  height={1}
                  minWidth={0}
                  flexShrink={1}
                  wrapMode="none"
                  paddingLeft={index() === 0 ? 1 : 0}
                  fg={tokens().colors.mutedForeground}
                >
                  {item.label}
                </text>
              }
            >
              <CommandControl
                id={`breadcrumb-${index()}`}
                intent="menu"
                showDisabledReason={false}
                record={{
                  id: `breadcrumb.${index()}`,
                  verb: item.label,
                  destination: item.label,
                  scope: "widget",
                  keys: ["enter"],
                  enabled: true,
                  danger: false,
                }}
                register={(target) => {
                  const unregister = props.focusRegistry.register(
                    `command:breadcrumb.${index()}`,
                    target,
                  );
                  const unregisterMode = props.focusRegistry.registerModeHandler(target, (key) => {
                    if (key.name !== "left" && key.name !== "right") return "declined";
                    const step = key.name === "left" ? -1 : 1;
                    const items = visible();
                    for (
                      let next = index() + step;
                      next >= 0 && next < items.length;
                      next += step
                    ) {
                      if (!items[next]?.select) continue;
                      props.focusRegistry.applyFocus(`command:breadcrumb.${next}`);
                      break;
                    }
                    return "consumed";
                  });
                  return () => {
                    unregisterMode();
                    unregister();
                  };
                }}
                execute={() => item.select?.()}
              />
            </Show>
          </>
        )}
      </For>
    </box>
  );
}
