import { expect, test } from "bun:test";
import type { ThemeMode } from "@opentui/core";
import { createThemeStore, terminal, type ThemeModeSource } from "../../src/ui/theme";

function source(initial: ThemeMode | null) {
  let mode = initial;
  const listeners = new Set<(next: ThemeMode) => void>();
  const value: ThemeModeSource = {
    get themeMode() {
      return mode;
    },
    on(_event, listener) {
      listeners.add(listener);
    },
    off(_event, listener) {
      listeners.delete(listener);
    },
  };
  return {
    value,
    emit(next: ThemeMode) {
      mode = next;
      for (const listener of listeners) listener(next);
    },
    listenerCount: () => listeners.size,
  };
}

test("Theme store releases followed renderer modes and preserves the most recent active source", () => {
  const store = createThemeStore({
    base: terminal,
    themes: {
      test: {
        light: { colors: { foreground: "#f5f5f5" } },
        dark: { colors: { foreground: "#151515" } },
      },
    },
    active: "test",
  });
  const first = source("light");
  const second = source("dark");
  const stopFirst = store.follow(first.value);
  const stopSecond = store.follow(second.value);

  expect(first.listenerCount()).toBe(1);
  expect(second.listenerCount()).toBe(1);
  expect(store.get().colors.foreground).toBe("#151515");

  first.emit("light");
  expect(store.get().colors.foreground).toBe("#f5f5f5");

  stopFirst();
  expect(first.listenerCount()).toBe(0);
  expect(store.get().colors.foreground).toBe("#151515");

  first.emit("light");
  expect(store.get().colors.foreground).toBe("#151515");
  stopSecond();
  expect(second.listenerCount()).toBe(0);
});
