import { batch, createSignal } from "solid-js";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const validWidth = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 30;

export function createPreferences(
  file = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "skctl",
    "tui-preferences.json",
  ),
) {
  const [width, setWidth] = createSignal(38);
  const [saved, setSaved] = createSignal(38);
  const [problem, setProblem] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  let writable = true;
  let edited = false;
  let loading: Promise<void> | undefined;
  return {
    width,
    saved,
    saving,
    problem,
    dirty: () => width() !== saved(),
    preview(value: number) {
      if (validWidth(value)) {
        edited = true;
        setWidth(value);
      }
    },
    load() {
      if (loading) return loading;
      loading = (async () => {
        try {
          const value: unknown = JSON.parse(await readFile(file, "utf8"));
          if (!value || typeof value !== "object" || !("version" in value))
            throw new Error("Invalid interface preferences");
          if (value.version !== 1) {
            writable = false;
            throw new Error("Unsupported preferences version; the file will not be overwritten");
          }
          if (!("browserWidthColumns" in value) || !validWidth(value.browserWidthColumns))
            throw new Error("Invalid browser width; using 38 columns");
          const columns = value.browserWidthColumns;
          batch(() => {
            setSaved(columns);
            if (!edited) setWidth(columns);
          });
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
            setProblem(
              error instanceof Error ? error.message : "Cannot read interface preferences",
            );
        }
      })().finally(() => {
        loading = undefined;
      });
      return loading;
    },
    async save() {
      if (loading) await loading;
      if (!writable || saving()) return false;
      const value = width();
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      setSaving(true);
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
          temporary,
          JSON.stringify({ version: 1, browserWidthColumns: value }) + "\n",
          {
            mode: 0o600,
            flag: "wx",
          },
        );
        await rename(temporary, file);
        batch(() => {
          setSaved(value);
          setProblem(undefined);
        });
        return true;
      } catch (error) {
        setProblem(
          `Not saved: ${error instanceof Error ? error.message : "Cannot write preferences"}`,
        );
        return false;
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
        setSaving(false);
      }
    },
    cancel() {
      edited = false;
      setWidth(saved());
    },
  };
}

export type Preferences = ReturnType<typeof createPreferences>;
