/** @jsxImportSource @opentui/solid */
// Source: https://tuiparts.sh/r/solid/button.json, @tuiparts/solid@0.0.5 (MIT).
import { Button as ButtonPrimitive } from "@tuiparts/solid/button";
import { splitProps } from "solid-js";
import { tint } from "./theme";
import { useTheme } from "./use-theme";
export interface ButtonProps extends Omit<ButtonPrimitive.Props, "children"> {
  intent?: "neutral" | "primary" | "danger" | "quiet";
  label: string;
  size?: "compact" | "comfortable";
  /** Composite controls may omit the marker without changing padding or native focus. */
  showFocusIndicator?: boolean;
}
export function Button(props: ButtonProps) {
  const [recipe, root] = splitProps(props, [
    "disabled",
    "intent",
    "label",
    "size",
    "showFocusIndicator",
  ]);
  const tokens = useTheme();
  const intent = () => recipe.intent ?? "neutral";
  const foreground = (state: ButtonPrimitive.State) =>
    state.disabled
      ? tokens().colors.disabledForeground
      : state.focused || state.pressed || intent() === "primary"
        ? intent() === "danger"
          ? tokens().colors.destructiveForeground
          : tokens().colors.primaryForeground
        : intent() === "danger"
          ? tokens().colors.destructiveSurfaceForeground
          : tokens().colors.controlForeground;
  return (
    <ButtonPrimitive backgroundColor="transparent" disabled={recipe.disabled} {...root}>
      {(state: ButtonPrimitive.State) => (
        <box
          backgroundColor={
            state.disabled
              ? tokens().colors.disabled
              : state.pressed
                ? tint(
                    intent() === "danger" ? tokens().colors.destructive : tokens().colors.primary,
                    tokens().colors.background,
                    0.18,
                  )
                : state.focused
                  ? intent() === "danger"
                    ? tokens().colors.destructive
                    : tokens().colors.primary
                  : intent() === "primary"
                    ? tokens().colors.primary
                    : intent() === "danger"
                      ? tokens().colors.destructiveSurface
                      : tokens().colors.control
          }
          flexDirection="row"
          paddingRight={
            recipe.size === "comfortable"
              ? tokens().density.comfortablePaddingX
              : tokens().density.paddingX
          }
        >
          <text
            width={
              recipe.size === "comfortable"
                ? tokens().density.comfortablePaddingX
                : tokens().density.paddingX
            }
            fg={foreground(state)}
          >
            {state.focused && recipe.showFocusIndicator !== false ? "›" : " "}
          </text>
          <text content={recipe.label} wrapMode="none" fg={foreground(state)} />
        </box>
      )}
    </ButtonPrimitive>
  );
}
