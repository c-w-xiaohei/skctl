import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRoot } from "solid-js";
import { createPreferences } from "../src/preferences";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
async function preferences(initial?: string) {
  const directory = await mkdtemp(join(tmpdir(), "sktui-preferences-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "tui-preferences.json");
  if (initial) await writeFile(file, initial);
  const store = createRoot((dispose) => {
    cleanup.push(dispose);
    return createPreferences(file);
  });
  await store.load();
  return { file, store };
}

test("width previews cancel without writing and explicit save survives a fresh owner", async () => {
  const { file, store } = await preferences();
  expect(store.width()).toBe(38);
  store.preview(52);
  expect(store.width()).toBe(52);
  store.cancel();
  expect(store.width()).toBe(38);
  expect(await Bun.file(file).exists()).toBe(false);
  store.preview(52);
  expect(await store.save()).toBe(true);
  const next = createRoot((dispose) => {
    cleanup.push(dispose);
    return createPreferences(file);
  });
  await next.load();
  expect(next.width()).toBe(52);
  expect(next.dirty()).toBe(false);
});

test("invalid preferences fall back while unknown versions cannot be overwritten", async () => {
  const invalid = await preferences('{"version":1,"browserWidthColumns":-10}');
  expect(invalid.store.width()).toBe(38);
  expect(invalid.store.problem()).toBeTruthy();
  const future = '{"version":2,"browserWidthColumns":52}';
  const { file, store } = await preferences(future);
  store.preview(60);
  expect(await store.save()).toBe(false);
  expect(await readFile(file, "utf8")).toBe(future);
});

test("failed save retains the preview and reports unsaved state", async () => {
  const { file, store } = await preferences();
  await writeFile(join(file, "..", "blocker"), "not a directory");
  const failing = createRoot((dispose) => {
    cleanup.push(dispose);
    return createPreferences(join(file, "..", "blocker", "preferences.json"));
  });
  await failing.load();
  failing.preview(56);
  expect(await failing.save()).toBe(false);
  expect(failing.width()).toBe(56);
  expect(failing.dirty()).toBe(true);
  expect(failing.problem()).toBeTruthy();
  expect(store.width()).toBe(38);
});

test("a pending preferences load preserves edits and Cancel uses the loaded saved width", async () => {
  const { file, store } = await preferences('{"version":1,"browserWidthColumns":48}');
  const loading = store.load();
  store.preview(62);
  await loading;
  expect(store.width()).toBe(62);
  expect(store.saved()).toBe(48);
  store.cancel();
  expect(store.width()).toBe(48);
  expect(JSON.parse(await readFile(file, "utf8")).browserWidthColumns).toBe(48);
});

test("Save waits for version validation when preferences are still loading", async () => {
  const { file } = await preferences('{"version":2,"browserWidthColumns":48}');
  const store = createRoot((dispose) => {
    cleanup.push(dispose);
    return createPreferences(file);
  });
  const loading = store.load();
  store.preview(62);
  const saved = store.save();
  await loading;
  expect(await saved).toBe(false);
  expect(JSON.parse(await readFile(file, "utf8")).version).toBe(2);
});
