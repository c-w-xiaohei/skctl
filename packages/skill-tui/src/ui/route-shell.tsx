/** @jsxImportSource @opentui/solid */
import { Show, untrack, type JSXElement } from "solid-js";
import type { LayoutMode } from "../types";
import { useTheme } from "./use-theme";

export interface RouteShellSlots {
  readonly globalBar: JSXElement | (() => JSXElement);
  readonly sectionNav: JSXElement | (() => JSXElement);
  readonly routeTitle: JSXElement | (() => JSXElement);
  readonly content: JSXElement | (() => JSXElement);
  readonly commandStatus: JSXElement | (() => JSXElement);
}

export interface RouteShellProps {
  readonly mode: LayoutMode;
  readonly slots: RouteShellSlots;
}

function Slot(props: { readonly value: JSXElement | (() => JSXElement) }) {
  const content = untrack(() => (typeof props.value === "function" ? props.value() : props.value));
  return <>{content}</>;
}

/** Application chrome owns layout; page state and commands stay with their owners. */
export function RouteShell(props: RouteShellProps) {
  const tokens = useTheme();
  const wide = () => props.mode === "wide";
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
          height={2}
          flexShrink={0}
          paddingX={1}
          border={["bottom"]}
          borderColor={tokens().colors.border}
        >
          <Slot value={props.slots.globalBar} />
        </box>
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <Show when={wide()}>
            <box
              id="section-nav"
              width={22}
              flexShrink={0}
              flexDirection="column"
              paddingX={1}
              paddingTop={1}
              border={["right"]}
              borderColor={tokens().colors.border}
            >
              <text fg={tokens().colors.mutedForeground}>PAGES</text>
              <box height={1} />
              <Slot value={props.slots.sectionNav} />
            </box>
          </Show>
          <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0} paddingX={1}>
            <Show when={!wide()}>
              <box id="section-nav" height={1} flexShrink={0}>
                <Slot value={props.slots.sectionNav} />
              </box>
            </Show>
            <box id="route-title" flexDirection="column" flexShrink={0} height={2}>
              <Slot value={props.slots.routeTitle} />
            </box>
            <box id="route-content" flexGrow={1} minHeight={0} minWidth={0}>
              <Slot value={props.slots.content} />
            </box>
          </box>
        </box>
        <box
          id="command-status"
          height={3}
          flexShrink={0}
          paddingX={1}
          border={["top"]}
          borderColor={tokens().colors.border}
        >
          <Slot value={props.slots.commandStatus} />
        </box>
      </box>
    </Show>
  );
}
