/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { InputRenderable, ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SourceRegistrationOverlay } from "../src/operations";
import { theme } from "../src/ui/theme";
import { enterLive, focusLive, live, parsedEnter, parsedEscape } from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;
type Registration = Parameters<Parameters<typeof SourceRegistrationOverlay>[0]["onSubmit"]>[0];

afterEach(() => {
  theme.override(undefined);
  theme.setMode("system");
});

async function capture(setup: Setup, name: string) {
  const directory = process.env.PAGE_INTERACTION_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.txt`), setup.captureCharFrame());
  await writeFile(join(directory, `${name}.json`), JSON.stringify(setup.captureSpans(), null, 2));
}

async function fill(setup: Setup, id: string, text: string) {
  const field = await focusLive(setup, id);
  if (!(field instanceof InputRenderable)) throw new Error(`${id} is not a native input`);
  await setup.mockInput.typeText(text);
  await setup.renderOnce();
  expect(field.value).toBe(text);
  return field;
}

async function chooseKind(setup: Setup, index: number) {
  const kind = await focusLive(setup, "source-register-kind");
  if (!(kind instanceof SelectRenderable)) throw new Error("Expected native kind choice");
  while (kind.getSelectedIndex() < index) {
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
  }
  while (kind.getSelectedIndex() > index) {
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
  }
  await parsedEnter(setup);
}

async function expectLabelBeside(setup: Setup, id: string, label: string) {
  const field = await focusLive(setup, id);
  let ancestor = field.parent;
  while (ancestor && !(ancestor instanceof ScrollBoxRenderable)) ancestor = ancestor.parent;
  if (!(ancestor instanceof ScrollBoxRenderable))
    throw new Error(`Missing modal viewport for ${id}`);
  const body = ancestor;
  await setup.waitForFrame(
    (frame) =>
      setup.renderer.currentFocusedRenderable === field &&
      field.screenY >= body.viewport.screenY &&
      field.screenY + field.height <= body.viewport.screenY + body.viewport.height &&
      frame.split("\n")[field.screenY]?.includes(label) === true,
  );
  expect(field.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
  expect(field.screenY + field.height).toBeLessThanOrEqual(
    body.viewport.screenY + body.viewport.height,
  );
  const row = setup.captureCharFrame().split("\n")[field.screenY]!;
  expect(row).toContain(label);
  expect(field.screenX).toBeGreaterThan(row.indexOf(label));
}

for (const registrationKind of ["source", "config-source"] as const) {
  for (const bindingKind of ["local", "git", "github"] as const) {
    test.each(["dark", "light"] as const)(
      `${registrationKind} ${bindingKind} populated fields keep concise labels, native values and exact binding in %s`,
      async (mode) => {
        theme.setMode(mode);
        theme.override({
          colors: {
            background: mode === "dark" ? "#1b2025" : "#f4f6f8",
            foreground: mode === "dark" ? "#e8eef5" : "#142435",
          },
        });
        const submitted: Registration[] = [];
        const setup = await testRender(
          () => (
            <SourceRegistrationOverlay
              kind={registrationKind}
              level="local"
              pending={false}
              onSubmit={(value) => submitted.push(value)}
              onCancel={() => {}}
            />
          ),
          { width: 80, height: 24 },
        );
        try {
          await setup.waitFor(
            () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
          );
          await chooseKind(setup, ["local", "git", "github"].indexOf(bindingKind));
          await fill(setup, "source-register-id", "team");
          if (bindingKind === "github") {
            await fill(setup, "source-register-github-owner", "acme");
            await fill(setup, "source-register-github-repository", "skills");
          } else {
            await fill(
              setup,
              "source-register-origin",
              bindingKind === "local" ? "/shared/skills" : "https://example.com/skills.git",
            );
          }
          await fill(setup, "source-register-root", "skills");
          await expectLabelBeside(setup, "source-register-root", "Source root");
          await capture(
            setup,
            `registration-${registrationKind}-${bindingKind}-${mode}-80x24-populated`,
          );
          setup.resize(43, 13);
          await setup.renderOnce();
          await expectLabelBeside(setup, "source-register-id", "Source ID");
          await capture(setup, `registration-${registrationKind}-${bindingKind}-${mode}-43x13-id`);
          if (bindingKind === "github") {
            await expectLabelBeside(setup, "source-register-github-owner", "GitHub owner");
            await expectLabelBeside(setup, "source-register-github-repository", "Repository");
          } else {
            await expectLabelBeside(
              setup,
              "source-register-origin",
              bindingKind === "local" ? "Local path" : "Git origin",
            );
          }
          if (bindingKind !== "local")
            await expectLabelBeside(setup, "source-register-ref", "Tracked ref");
          await expectLabelBeside(setup, "source-register-root", "Source root");
          await capture(
            setup,
            `registration-${registrationKind}-${bindingKind}-${mode}-43x13-populated`,
          );
          await enterLive(setup, "source-register-submit");
          expect(submitted).toEqual([
            {
              level: "local",
              id: "team",
              binding:
                bindingKind === "github"
                  ? {
                      kind: "github",
                      owner: "acme",
                      repository: "skills",
                      origin: "https://github.com/acme/skills",
                      ref: "main",
                      root: "skills",
                    }
                  : bindingKind === "git"
                    ? {
                        kind: "git",
                        origin: "https://example.com/skills.git",
                        ref: "main",
                        root: "skills",
                      }
                    : { kind: "local", path: "/shared/skills", root: "skills" },
            },
          ]);
        } finally {
          setup.renderer.destroy();
        }
      },
    );
  }
}

test("kind activation, failed submission and short resize retain labeled edit buffers and explicit level", async () => {
  const submitted: Registration[] = [];
  let cancel = 0;
  let setState!: (value: { pending: boolean; error?: { code: string; message: string } }) => void;
  const setup = await testRender(
    () => {
      const [state, update] = createSignal<{
        pending: boolean;
        error?: { code: string; message: string };
      }>({ pending: false });
      setState = update;
      return (
        <SourceRegistrationOverlay
          kind="config-source"
          pending={state().pending}
          error={state().error}
          onSubmit={(value) => submitted.push(value)}
          onCancel={() => cancel++}
        />
      );
    },
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-level",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    await parsedEnter(setup);
    const id = await fill(setup, "source-register-id", "shared");
    const origin = await fill(setup, "source-register-origin", "/shared/config");
    const root = await fill(setup, "source-register-root", ".");
    // Moving the candidate does not activate a different binding kind.
    await focusLive(setup, "source-register-kind");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(live(setup, "source-register-origin")).toBe(origin);
    expect(setup.renderer.root.findDescendantById("source-register-github-owner")).toBeUndefined();
    await parsedEnter(setup);
    await fill(setup, "source-register-github-owner", "acme");
    await fill(setup, "source-register-github-repository", "config");
    await enterLive(setup, "source-register-submit");
    setState({ pending: true });
    await setup.renderOnce();
    await parsedEnter(setup);
    expect(submitted).toHaveLength(1);
    setState({
      pending: false,
      error: { code: "WRITE_FAILED", message: "Fix the declaration and retry" },
    });
    await setup.renderOnce();
    expect(live(setup, "source-register-id")).toBe(id);
    expect(live(setup, "source-register-root")).toBe(root);
    expect(id.value).toBe("shared");
    setup.resize(43, 13);
    await setup.renderOnce();
    for (const [field, label] of [
      ["source-register-id", "Source ID"],
      ["source-register-github-owner", "GitHub owner"],
      ["source-register-github-repository", "Repository"],
      ["source-register-ref", "Tracked ref"],
      ["source-register-root", "Source root"],
    ])
      await expectLabelBeside(setup, field!, label!);
    await enterLive(setup, "source-register-submit");
    expect(submitted[1]).toEqual(submitted[0]);
    expect(submitted[1]?.level).toBe("local");
    await chooseKind(setup, 0);
    expect((live(setup, "source-register-origin") as InputRenderable).value).toBe("/shared/config");
    expect(live(setup, "source-register-id")).toBe(id);
    expect(live(setup, "source-register-root")).toBe(root);
    await expectLabelBeside(setup, "source-register-origin", "Local path");
    await parsedEscape(setup);
    expect(cancel).toBe(1);
    expect(submitted).toHaveLength(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("persistent labels do not relax immutable binding input validation", async () => {
  const submitted: Registration[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        level="project"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    await chooseKind(setup, 1);
    await fill(setup, "source-register-id", "team");
    await fill(setup, "source-register-origin", "https://user@example.com/repo.git");
    await fill(setup, "source-register-root", ".");
    expect(live(setup, "source-register-submit").focusable).toBe(false);
    await enterLive(setup, "source-register-choice");
    expect(submitted).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
