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
  return (
    <ButtonPrimitive backgroundColor="transparent" disabled={recipe.disabled} {...root}>
      {(state: ButtonPrimitive.State) => (
        <box
          backgroundColor={
            state.disabled
              ? tokens().colors.disabled
              : state.pressed
                ? tint(
                    recipe.intent === "danger"
                      ? tokens().colors.destructive
                      : tokens().colors.primary,
                    tokens().colors.foreground,
                    0.15,
                  )
                : state.focused
                  ? recipe.intent === "danger"
                    ? tokens().colors.destructive
                    : tokens().colors.primary
                  : (recipe.intent ?? "primary") === "primary"
                    ? tokens().colors.primary
                    : recipe.intent === "quiet"
                      ? "transparent"
                      : tokens().colors.surface
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
            fg={tokens().colors.primaryForeground}
          >
            {state.focused && recipe.showFocusIndicator !== false ? "›" : " "}
          </text>
          <text
            content={recipe.label}
            wrapMode="none"
            fg={
              state.disabled
                ? tokens().colors.disabledForeground
                : state.focused || state.pressed || (recipe.intent ?? "primary") === "primary"
                  ? tokens().colors.primaryForeground
                  : recipe.intent === "danger"
                    ? tokens().colors.destructive
                    : recipe.intent === "quiet"
                      ? tokens().colors.mutedForeground
                      : tokens().colors.foreground
            }
          />
        </box>
      )}
    </ButtonPrimitive>
  );
}
