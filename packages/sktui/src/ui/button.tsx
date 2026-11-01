/** @jsxImportSource @opentui/solid */
// Source: https://tuiparts.sh/r/solid/button.json, @tuiparts/solid@0.0.5 (MIT).
import { Button as ButtonPrimitive } from "@tuiparts/solid/button";
import { Show, splitProps } from "solid-js";
import { tint } from "./theme";
import { useTheme } from "./use-theme";
export interface ButtonProps extends Omit<ButtonPrimitive.Props, "children"> {
  intent?: "neutral" | "primary" | "danger" | "quiet" | "menu";
  label: string;
  shortcutHint?: string;
  size?: "compact" | "comfortable";
  /** Composite controls may omit the marker without changing padding or native focus. */
  showFocusIndicator?: boolean;
}
export function Button(props: ButtonProps) {
  const [recipe, root] = splitProps(props, [
    "disabled",
    "intent",
    "label",
    "shortcutHint",
    "size",
    "showFocusIndicator",
  ]);
  const tokens = useTheme();
  const intent = () => recipe.intent ?? "neutral";
  const foreground = (state: ButtonPrimitive.State) =>
    state.disabled
      ? tokens().colors.disabledForeground
      : state.pressed || intent() === "primary"
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
                : intent() === "primary"
                  ? tokens().colors.primary
                  : state.focused
                    ? intent() === "danger"
                      ? tint(tokens().colors.destructiveSurface, tokens().colors.destructive, 0.25)
                      : tint(tokens().colors.control, tokens().colors.focus, 0.25)
                    : intent() === "menu"
                      ? "transparent"
                      : intent() === "danger"
                        ? tokens().colors.destructiveSurface
                        : intent() === "quiet"
                          ? tint(tokens().colors.control, tokens().colors.surface, 0.5)
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
          <Show when={recipe.shortcutHint}>
            <text
              marginLeft={2}
              content={recipe.shortcutHint}
              wrapMode="none"
              fg={tokens().colors.mutedForeground}
            />
          </Show>
        </box>
      )}
    </ButtonPrimitive>
  );
}
