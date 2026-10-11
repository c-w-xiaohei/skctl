// Source: https://tuiparts.sh/r/solid/theme.json, @tuiparts/solid@0.0.5 (MIT).
import { type ColorInput, parseColor, RGBA, type ThemeMode } from "@opentui/core";
export interface Tokens {
  colors: {
    background: ColorInput;
    surface: ColorInput;
    foreground: ColorInput;
    mutedForeground: ColorInput;
    border: ColorInput;
    focus: ColorInput;
    primary: ColorInput;
    primaryForeground: ColorInput;
    destructive: ColorInput;
    destructiveForeground: ColorInput;
    success: ColorInput;
    successForeground: ColorInput;
    warning: ColorInput;
    warningForeground: ColorInput;
    disabled: ColorInput;
    disabledForeground: ColorInput;
  };
  glyphs: { check: string; radio: string; thumb: string; track: string };
  borders: { style: "single" | "rounded" | "double" | "heavy" };
  density: { paddingX: number; comfortablePaddingX: number };
}
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends RGBA ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export interface ThemeDefinition {
  tokens?: DeepPartial<Tokens>;
  dark?: DeepPartial<Tokens>;
  light?: DeepPartial<Tokens>;
}
export type ThemeModeSetting = ThemeMode | "system";
export interface ThemeModeSource {
  readonly themeMode: ThemeMode | null;
  on(event: "theme_mode", listener: (mode: ThemeMode) => void): unknown;
  off(event: "theme_mode", listener: (mode: ThemeMode) => void): unknown;
}
export interface ThemeStoreConfig {
  base: Tokens;
  themes?: Record<string, ThemeDefinition>;
  active?: string;
  mode?: ThemeModeSetting;
}
export interface ThemeStore {
  get(): Readonly<Tokens>;
  subscribe(listener: () => void): () => void;
  setActive(name: string): boolean;
  setMode(mode: ThemeModeSetting): void;
  override(tokens: DeepPartial<Tokens> | undefined): void;
  register(name: string, definition: ThemeDefinition): void;
  follow(source: ThemeModeSource): () => void;
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}
function deepMerge<T>(base: T, layer: DeepPartial<T>): T {
  const merged: Record<string, unknown> = { ...(base as object) };
  for (const [key, value] of Object.entries(layer as object)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] =
      isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return merged as T;
}
function deepFrozen<T>(value: T): Readonly<T> {
  if (!isPlainObject(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) copy[key] = deepFrozen(child);
  return Object.freeze(copy) as Readonly<T>;
}
export function createThemeStore(config: ThemeStoreConfig): ThemeStore {
  const themes = new Map(Object.entries(config.themes ?? {}));
  const listeners = new Set<() => void>();
  const followedSources = new Map<ThemeModeSource, number>();
  const detectedSources = new Map<ThemeModeSource, ThemeMode>();
  let active = config.active ?? "";
  let mode: ThemeModeSetting = config.mode ?? "system";
  let detected: ThemeMode | undefined;
  let overrides: DeepPartial<Tokens> | undefined;
  let snapshot: Readonly<Tokens>;
  const resolvedMode = (): ThemeMode => (mode === "system" ? (detected ?? "dark") : mode);
  const resolve = () => {
    const definition = themes.get(active);
    snapshot = deepFrozen(
      [definition?.tokens, definition?.[resolvedMode()], overrides].reduce<Tokens>(
        (tokens, layer) => (layer ? deepMerge(tokens, layer) : tokens),
        config.base,
      ),
    );
  };
  resolve();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const recomputeDetected = () => {
    const next = Array.from(detectedSources.values()).at(-1);
    if (next === detected) return;
    const before = resolvedMode();
    detected = next;
    if (mode === "system" && resolvedMode() !== before) {
      resolve();
      notify();
    }
  };
  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setActive(name) {
      if (!themes.has(name)) return false;
      if (name !== active) {
        active = name;
        resolve();
        notify();
      }
      return true;
    },
    setMode(next) {
      if (next === mode) return;
      const before = resolvedMode();
      mode = next;
      if (resolvedMode() !== before) {
        resolve();
        notify();
      }
    },
    override(tokens) {
      overrides = tokens;
      resolve();
      notify();
    },
    register(name, definition) {
      themes.set(name, definition);
      if (name === active) {
        resolve();
        notify();
      }
    },
    follow(source) {
      followedSources.set(source, (followedSources.get(source) ?? 0) + 1);
      const apply = (next: ThemeMode) => {
        detectedSources.delete(source);
        detectedSources.set(source, next);
        recomputeDetected();
      };
      if (source.themeMode) apply(source.themeMode);
      const listener = (next: ThemeMode) => apply(next);
      source.on("theme_mode", listener);
      return () => {
        source.off("theme_mode", listener);
        const follows = followedSources.get(source);
        if (follows === 1) {
          followedSources.delete(source);
          detectedSources.delete(source);
          recomputeDetected();
        } else if (follows) followedSources.set(source, follows - 1);
      };
    },
  };
}
export function tint(base: ColorInput, overlay: ColorInput, alpha: number): RGBA {
  const from = parseColor(base);
  const to = parseColor(overlay);
  const channel = (a: number, b: number) => Math.round((a + (b - a) * alpha) * 255);
  return RGBA.fromInts(
    channel(from.r, to.r),
    channel(from.g, to.g),
    channel(from.b, to.b),
    Math.round(from.a * 255),
  );
}
export const terminal: Tokens = {
  colors: {
    background: RGBA.defaultBackground(),
    surface: RGBA.fromIndex(8),
    foreground: RGBA.defaultForeground(),
    mutedForeground: RGBA.fromIndex(7),
    border: RGBA.fromIndex(8),
    focus: RGBA.fromIndex(12),
    primary: RGBA.fromIndex(4),
    primaryForeground: RGBA.fromIndex(15),
    destructive: RGBA.fromIndex(1),
    destructiveForeground: RGBA.fromIndex(15),
    success: RGBA.fromIndex(2),
    successForeground: RGBA.fromIndex(15),
    warning: RGBA.fromIndex(3),
    warningForeground: RGBA.fromIndex(0),
    disabled: RGBA.fromIndex(0),
    disabledForeground: RGBA.fromIndex(8),
  },
  glyphs: { check: "✓", radio: "●", thumb: "●", track: "─" },
  borders: { style: "single" },
  density: { paddingX: 1, comfortablePaddingX: 2 },
};

/** Native list colors share the same selection language as tabs and commands. */
export const selectColors = (tokens: Readonly<Tokens>) => ({
  backgroundColor: tokens.colors.background,
  focusedBackgroundColor: tokens.colors.background,
  textColor: tokens.colors.foreground,
  focusedTextColor: tokens.colors.foreground,
  selectedBackgroundColor: tokens.colors.primary,
  selectedTextColor: tokens.colors.primaryForeground,
  descriptionColor: tokens.colors.mutedForeground,
  selectedDescriptionColor: tokens.colors.primaryForeground,
});
export const theme = createThemeStore({
  base: terminal,
  themes: {
    terminal: {
      dark: {
        colors: {
          surface: "#293544",
          mutedForeground: "#a5b2c2",
          border: "#526173",
          focus: "#80b7f5",
          primary: "#3565a0",
          primaryForeground: "#ffffff",
        },
      },
      light: {
        colors: {
          surface: "#dce6f0",
          mutedForeground: "#4c5e73",
          border: "#8595a8",
          focus: "#245a98",
          primary: "#245a98",
          primaryForeground: "#ffffff",
        },
      },
    },
  },
  active: "terminal",
  mode: "system",
});
