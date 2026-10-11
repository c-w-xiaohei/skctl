/** @jsxImportSource @opentui/solid */
import { useTheme } from "./use-theme";
export interface CommandButtonProps {
  readonly label: string;
  readonly state: "idle" | "focused" | "disabled" | "danger";
  readonly destination?: string;
  readonly disabledReason?: string;
  readonly danger?: boolean;
}

export function CommandButton(props: CommandButtonProps) {
  const tokens = useTheme();
  const danger = () => props.danger || props.state === "danger";
  return (
    <box flexDirection="column" flexShrink={0}>
      <text
        wrapMode="word"
        fg={
          props.state === "disabled"
            ? tokens().colors.disabledForeground
            : danger()
              ? tokens().colors.destructive
              : props.state === "focused"
                ? tokens().colors.primaryForeground
                : tokens().colors.foreground
        }
        bg={props.state === "focused" ? tokens().colors.primary : "transparent"}
      >
        {`${props.state === "focused" ? "› " : "  "}[ ${danger() ? "! " : ""}${props.label} ]`}
      </text>
      {props.state === "disabled" && props.disabledReason && (
        <text wrapMode="word" fg={tokens().colors.mutedForeground}>
          {`  ${props.disabledReason}`}
        </text>
      )}
    </box>
  );
}
