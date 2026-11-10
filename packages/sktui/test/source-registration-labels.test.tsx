import { expect, test } from "bun:test";
import { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { SourceRegistrationOverlay } from "../src/operations";
import { enterLive, focusLive } from "./reader-test-controls";

for (const width of [80, 43]) {
  for (const kind of ["source", "config-source"] as const) {
    test(`${kind} retains labeled address and advanced drafts at ${width} columns`, async () => {
      const submitted: unknown[] = [];
      const setup = await testRender(
        () => (
          <SourceRegistrationOverlay
            kind={kind}
            level="local"
            pending={false}
            configFile={() => "/project/skctl.local.jsonc"}
            onSubmit={(value) => submitted.push(value)}
            onCancel={() => {}}
            onBack={() => {}}
          />
        ),
        { width, height: 13 },
      );
      try {
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
        );
        await setup.mockInput.typeText("/shared/skills");
        await setup.renderOnce();
        const submit = setup.renderer.root.findDescendantById("source-register-submit")!;
        const cancel = setup.renderer.root.findDescendantById("source-register-choice")!;
        const back = setup.renderer.root.findDescendantById("source-register-back")!;
        for (const control of [submit, cancel, back]) {
          expect(control.screenX + control.width).toBeLessThanOrEqual(width);
          expect(control.screenY + control.height).toBeLessThanOrEqual(12);
        }
        let parent = setup.renderer.root.findDescendantById("source-register-origin")!.parent;
        while (parent && !(parent instanceof ScrollBoxRenderable)) parent = parent.parent;
        expect((parent as ScrollBoxRenderable).viewport.height).toBeGreaterThanOrEqual(6);
        await focusLive(setup, "source-register-id");
        const id = setup.renderer.currentFocusedRenderable as InputRenderable;
        id.value = "team";
        await setup.renderOnce();
        await enterLive(setup, "source-register-advanced");
        await focusLive(setup, "source-register-root");
        await setup.mockInput.typeText("skills");
        await setup.renderOnce();
        expect(setup.captureCharFrame()).toContain("Source root");
        await enterLive(setup, "source-register-advanced");
        await enterLive(setup, "source-register-advanced");
        expect(
          (setup.renderer.root.findDescendantById("source-register-root") as InputRenderable).value,
        ).toBe("skills");
        await enterLive(setup, "source-register-submit");
        expect(submitted).toEqual([
          {
            level: "local",
            id: "team",
            binding: { kind: "local", path: "/shared/skills", root: "skills" },
          },
        ]);
      } finally {
        setup.renderer.destroy();
      }
    });
  }
}

test("credential-bearing remote address cannot be submitted", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText("https://user@example.com/skills.git");
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("source-register-submit")!.focusable).toBe(false);
    expect(submitted).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
