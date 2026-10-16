/** @jsxImportSource @opentui/solid */
// Source: https://tuiparts.sh/r/solid/input.json, @tuiparts/solid@0.0.5 (MIT).
import { Input as InputPrimitive } from "@tuiparts/solid/input";
import { tint } from "./theme";
import { useTheme } from "./use-theme";
export interface InputProps extends InputPrimitive.Props {
  /** OpenTUI Solid's render-level focus binding, also supported by the primitive's spread adapter. */
  readonly focused?: boolean;
}
export function Input(props: InputProps) {
  const tokens = useTheme();
  return (
    <InputPrimitive
      backgroundColor={tokens().colors.input}
      cursorColor={tokens().colors.focus}
      focusedBackgroundColor={tokens().colors.control}
      focusedTextColor={tokens().colors.controlForeground}
      placeholderColor={tint(tokens().colors.controlForeground, tokens().colors.input, 0.25)}
      textColor={tokens().colors.controlForeground}
      {...props}
    />
  );
}
