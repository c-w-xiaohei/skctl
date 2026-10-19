/** @jsxImportSource @opentui/solid */
import { Show, untrack, type JSXElement } from "solid-js";
import type { LayoutMode } from "../types";
import { useTheme } from "./use-theme";

const routeBackWidth = 6;
export const stackedNavigationBelow = 80;
export const compactControlsBelow = 100;

export interface RouteShellSlots {
  readonly scopeControls: JSXElement | (() => JSXElement);
  readonly activity: JSXElement | (() => JSXElement);
  readonly back: JSXElement | (() => JSXElement);
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
  const stacked = () => props.columns < stackedNavigationBelow;
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
        flexDirection="column"
        backgroundColor={tokens().colors.background}
      >
        <box
          id="global-bar"
          height={stacked() ? 3 : 2}
          flexDirection="column"
          flexShrink={0}
          paddingX={1}
          border={["bottom"]}
          borderColor={tokens().colors.border}
        >
          <box flexDirection={stacked() ? "column" : "row"} height={stacked() ? 2 : 1}>
            <box
              id="section-nav"
              flexGrow={stacked() ? 0 : 1}
              flexBasis={stacked() ? undefined : 0}
              flexShrink={1}
              minWidth={0}
              height={1}
              width={stacked() ? "100%" : "auto"}
            >
              <Slot value={props.slots.pageNavigation} />
            </box>
            <box
              id="shell-controls"
              flexDirection="row"
              gap={1}
              height={1}
              width={stacked() ? "100%" : "auto"}
              flexShrink={0}
            >
              <box id="workarea-navigation-pane" width={routeBackWidth} height={1} flexShrink={0}>
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
              <box id="shell-context-panel" flexDirection="row" gap={1} flexShrink={0} height={1}>
                <Slot value={props.slots.scopeControls} />
              </box>
              <box
                id="shell-activity"
                width={
                  stacked()
                    ? "auto"
                    : props.columns < compactControlsBelow
                      ? 9
                      : Math.min(36, 18 + Math.max(0, props.columns - 132))
                }
                flexGrow={stacked() ? 1 : 0}
                flexBasis={stacked() ? 0 : undefined}
                flexShrink={0}
                minWidth={0}
                height={1}
              >
                <Slot value={props.slots.activity} />
              </box>
            </box>
          </box>
        </box>
        <box id="route-content" flexGrow={1} minHeight={0} minWidth={0} paddingX={1}>
          <Slot value={props.slots.content} />
        </box>
        <box
          id="command-status"
          height={1}
          flexShrink={0}
          paddingX={1}
          backgroundColor={tokens().colors.surface}
        >
          <Slot value={props.slots.commandStatus} />
        </box>
      </box>
    </Show>
  );
}
