/** @jsxImportSource @opentui/solid */
import { Show, untrack, type JSXElement } from "solid-js";
import { useTerminalSize } from "./terminal-size";
import type { LayoutMode } from "../types";
import { useTheme } from "./use-theme";

const routeBackWidth = 11;
export const compactControlsBelow = 100;
export const footerActivityWidth = (columns: number) =>
  columns < 64 ? 14 : Math.min(36, Math.floor(columns / 3));

export interface RouteShellSlots {
  readonly scopeControls: JSXElement | (() => JSXElement);
  readonly activity: JSXElement | (() => JSXElement);
  readonly back: JSXElement | (() => JSXElement);
  readonly breadcrumbs: JSXElement | (() => JSXElement);
  readonly pageNavigation: JSXElement | (() => JSXElement);
  readonly content: JSXElement | (() => JSXElement);
  readonly commandStatus: JSXElement | (() => JSXElement);
}

export interface RouteShellProps {
  readonly mode: LayoutMode;
  readonly columns: number;
  readonly slots: RouteShellSlots;
}

function Slot(props: { readonly value: JSXElement | (() => JSXElement) }) {
  const content = untrack(() => (typeof props.value === "function" ? props.value() : props.value));
  return <>{content}</>;
}

/** Fixed chrome slots. Commands and activity may change, never the navigation geometry. */
export function RouteShell(props: RouteShellProps) {
  const tokens = useTheme();
  const terminal = useTerminalSize();
  const compact = () => terminal().height < 24;
  return (
    <Show
      when={props.mode !== "too-small"}
      fallback={
        <box id="resize-gate" flexDirection="column" width="100%" height="100%" padding={1}>
          <text>More room needed</text>
          <text wrapMode="word">Resize to at least 43 columns and 13 rows.</text>
        </box>
      }
    >
      <box
        id="route-shell"
        width="100%"
        height="100%"
        minWidth={0}
        overflow="hidden"
        flexDirection="column"
        backgroundColor={tokens().colors.background}
      >
        <box
          id="global-bar"
          height={compact() ? 1 : 2}
          flexDirection="column"
          flexShrink={0}
          paddingX={1}
          border={compact() ? [] : ["bottom"]}
          borderColor={tokens().colors.border}
        >
          <box flexDirection="row" height={1} gap={1}>
            <box id="section-nav" flexGrow={1} flexBasis={0} flexShrink={1} minWidth={0} height={1}>
              <Slot value={props.slots.pageNavigation} />
            </box>
            <box id="shell-controls" flexDirection="row" gap={1} height={1} flexShrink={0}>
              <box id="shell-context-panel" flexDirection="row" gap={1} flexShrink={0} height={1}>
                <Slot value={props.slots.scopeControls} />
              </box>
            </box>
          </box>
        </box>
        <box id="workspace-navigation" height={1} flexShrink={0} paddingX={1}>
          <box id="workarea-navigation-pane" flexDirection="row" width="100%" height={1} gap={1}>
            <box
              id="route-breadcrumbs"
              flexGrow={1}
              flexBasis={0}
              minWidth={0}
              height={1}
              overflow="hidden"
            >
              <Slot value={props.slots.breadcrumbs} />
            </box>
            <box
              id="route-back-slot"
              width={routeBackWidth}
              flexShrink={0}
              height={1}
              overflow="hidden"
            >
              <Slot value={props.slots.back} />
            </box>
          </box>
        </box>
        <box
          id="route-content"
          width="100%"
          flexGrow={1}
          minHeight={0}
          minWidth={0}
          overflow="hidden"
          paddingX={1}
        >
          <Slot value={props.slots.content} />
        </box>
        <box
          id="command-status"
          height={1}
          flexShrink={0}
          paddingX={1}
          backgroundColor={tokens().colors.surface}
          flexDirection="row"
          gap={1}
        >
          <box flexGrow={1} flexBasis={0} minWidth={0} height={1} overflow="hidden">
            <Slot value={props.slots.commandStatus} />
          </box>
          <box
            id="shell-activity"
            width={footerActivityWidth(props.columns)}
            height={1}
            flexShrink={0}
            overflow="hidden"
          >
            <Slot value={props.slots.activity} />
          </box>
        </box>
      </box>
    </Show>
  );
}
