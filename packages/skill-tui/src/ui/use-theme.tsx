// Source: https://tuiparts.sh/r/solid/theme.json, @tuiparts/solid@0.0.5 (MIT).
import { type Accessor, createSignal, onCleanup } from "solid-js";
import { type Tokens, theme } from "./theme";
export function useTheme(): Accessor<Readonly<Tokens>> {
  const [tokens, setTokens] = createSignal(theme.get());
  onCleanup(theme.subscribe(() => setTokens(theme.get())));
  return tokens;
}
