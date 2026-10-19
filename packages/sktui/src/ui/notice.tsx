/** @jsxImportSource @opentui/solid */
import type { JSXElement } from "solid-js";
import { useTheme } from "./use-theme";

/** Task feedback: one outcome, one target, a short explanation and real controls. */
export function Notice(props: {
  readonly id: string;
  readonly title: string;
  readonly target: string;
  readonly body: string;
  readonly children: JSXElement;
}) {
  const tokens = useTheme();
  return (
    <box
      id={props.id}
      flexDirection="column"
      flexShrink={0}
      border={["top"]}
      borderColor={tokens().colors.border}
    >
      <box height={1} flexDirection="row" columnGap={1} minWidth={0}>
        <text flexShrink={0} fg={tokens().colors.warning}>
          <strong>{props.title}</strong>
        </text>
        <text flexGrow={1} minWidth={0} wrapMode="none" fg={tokens().colors.mutedForeground}>
          {props.target}
        </text>
      </box>
      <text height={1} wrapMode="none" fg={tokens().colors.foreground}>
        {props.body}
      </text>
      <box flexDirection="row" columnGap={1} flexShrink={0}>
        {props.children}
      </box>
    </box>
  );
}
