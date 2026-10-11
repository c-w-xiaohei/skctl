import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerResources,
  readerSecondAddress,
} from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  selectedReaderTab,
} from "./reader-test-controls";

async function openSelectedSkillFromPointer(
  setup: Awaited<ReturnType<typeof testRender>>,
  address: string,
  loads: readonly string[],
) {
  const loadsBeforeOpen = loads.length;
  let browser = setup.renderer.root.findDescendantById("installed-skill-browser");
  if (!(browser instanceof SelectRenderable)) {
    browser = await openAllInstalledSkills(setup);
  }
  if (!(browser instanceof SelectRenderable))
    throw new Error("Installed Skill browser did not mount");
  const option = browser.options.find((item) => item.value === JSON.stringify(address.split("/")));
  if (!option) throw new Error(`Missing Installed Skill ${address}`);
  const index = browser.options.indexOf(option);
  const direction = index > browser.getSelectedIndex() ? "down" : "up";
  for (
    let step = browser.getSelectedIndex();
    step !== index;
    step += direction === "down" ? 1 : -1
  ) {
    setup.mockInput.pressArrow(direction);
    await setup.waitFor(() => {
      const next = setup.renderer.root.findDescendantById("installed-skill-browser");
      return (
        next instanceof SelectRenderable &&
        next.getSelectedIndex() === step + (direction === "down" ? 1 : -1)
      );
    });
    browser = (await focusLive(setup, "installed-skill-browser")) as SelectRenderable;
  }
  await setup.renderOnce();
  const current = setup.renderer.root.findDescendantById("installed-skill-browser");
  if (!(current instanceof SelectRenderable))
    throw new Error("Installed Skill browser remounted away");
  const row = setup
    .captureCharFrame()
    .split("\n")
    .slice(current.screenY, current.screenY + current.height)
    .findIndex((line) => line.includes(option.name));
  if (row < 0)
    throw new Error(
      `Installed Skill ${address} is outside mounted browser bounds:\n${setup
        .captureCharFrame()
        .split("\n")
        .slice(current.screenY, current.screenY + current.height)
        .join("\n")}`,
    );

  await setup.mockMouse.click(current.screenX + 1, current.screenY + row);
  expect(loads).toHaveLength(loadsBeforeOpen);
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
  );
  const inspector = setup.renderer.root.findDescendantById("skill-inspector");
  expect(inspector).toBeDefined();
  expect(setup.renderer.root.findDescendantById("skill-inspector-address")).toBeDefined();
  expect(setup.captureCharFrame()).toContain(`Address  ${address}`);
  const masterBrowser = setup.renderer.root.findDescendantById("installed-skill-browser");
  expect(masterBrowser).toBeInstanceOf(SelectRenderable);
  expect((masterBrowser as SelectRenderable).getSelectedOption()?.value).toBe(
    JSON.stringify(address.split("/")),
  );
  const target = setup.renderer.root.findDescendantById("skill-inspector-open-reader");
  if (!target || target.isDestroyed || !target.parent)
    throw new Error("Inspector Open control did not mount after pointer click");
  await setup.waitFor(() => setup.captureCharFrame().includes(`Address  ${address}`));
  expect(setup.captureCharFrame()).toContain(`Address  ${address}`);
  expect(loads).toHaveLength(loadsBeforeOpen);
  target.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === target);
  expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBe(masterBrowser);
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
  await setup.waitFor(() => loads.length === loadsBeforeOpen + 1);
}

async function parsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", onKeypress);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressKey("ESCAPE");
  });
  await Promise.resolve();
  await setup.renderOnce();
}

test("RENDER Installed Skill pointer opens its exact Inspector before explicitly loading Reader content", async () => {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => {
            loads.push(request.address.path);
            return {
              value:
                request.address.path === readerSecondAddress.path
                  ? {
                      address: readerSecondAddress,
                      name: "reference",
                      description: "custom",
                      rawText: "",
                      markdownText: "",
                    }
                  : readerContent,
              diagnostics: [],
            };
          },
          listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
          readInstalled: async (request) => ({
            value: {
              kind: "text" as const,
              path: request.path,
              text: "resource body",
              format: "text" as const,
            },
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSelectedSkillFromPointer(setup, "team-main/reference", loads);
    await setup.waitFor(() => loads.includes("reference"));
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    expect(selectedReaderTab(setup)).toBe(0);
    await parsedEscape(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    const restored = setup.renderer.root.findDescendantById("installed-skill-browser");
    expect(restored).toBeInstanceOf(SelectRenderable);
    expect((restored as SelectRenderable).getSelectedOption()?.value).toBe(
      '["team-main","reference"]',
    );
  } finally {
    setup.renderer.destroy();
  }
});
