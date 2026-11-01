import { afterEach, expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { CollectionView, WorkspaceView } from "@skctl/core";
import { App } from "../src/app";
import { directOwner, directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

function projection(): WorkspaceView {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Complete fixture required");
  const view = (
    id: string,
    children: string[] = [],
    skills = base.installedSkills,
  ): CollectionView => ({
    id,
    description: id,
    declared: [],
    repository: { derived: false, producers: [] },
    links: [],
    members: skills.map((skill) => ({ name: skill.name, address: skill.address, paths: [] })),
    references: children.map((collection) => ({
      name: collection,
      collection,
      description: collection,
      owner: directOwner,
    })),
  });
  const outside = {
    ...base.installedSkills[1]!,
    address: { source: "team-main", path: "outside" },
    name: "outside",
    description: "Different branch",
  };
  const collectionViews = [
    view("parent", ["child"], []),
    view("child"),
    ...Array.from({ length: 24 }, (_, i) => view(`other-${i}`, [], i === 0 ? [outside] : [])),
  ];
  return {
    ...base,
    installedSkills: [...base.installedSkills, outside],
    effective: {
      ...base.effective,
      status: "complete",
      collections: collectionViews.map((value) => value.id),
      collectionsView: collectionViews,
    },
  };
}

async function mount(width = 144, height = 40) {
  setup = await testRender(() => <App core={directSourceCore(projection())} exit={() => {}} />, {
    width,
    height,
  });
  await openAllInstalledSkills(setup);
  await focusLive(setup, "open-skills-filter");
  await parsedEnter(setup);
  await setup.waitFor(
    () => setup!.renderer.currentFocusedRenderable?.id === "skills-filter-dimensions",
  );
}

test("Filter native Dialog contains Tab and search Escape returns before dismissal", async () => {
  await mount();
  await setup!.waitForFrame((frame) => frame.includes("↑↓ dimension") && frame.includes("Skills"));
  const heading = setup!.renderer.root.findDescendantById("skills-filter-count-heading")!;
  const popup = setup!.renderer.root.findDescendantById("skills-filter-overlay")!;
  expect(heading.width).toBeGreaterThanOrEqual(6);
  expect(heading.screenX + heading.width).toBeLessThan(popup.screenX + popup.width);
  await setup!.mockInput.pressTab();
  await setup!.renderOnce();
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("skills-filter-search");
  const input = setup!.renderer.currentFocusedRenderable as InputRenderable;
  setup!.mockInput.typeText("child");
  await setup!.renderOnce();
  setup!.mockInput.pressArrow("left");
  await setup!.renderOnce();
  expect(setup!.renderer.currentFocusedRenderable === input).toBe(true);
  expect(input.value).toBe("child");
  await parsedEscape(setup!);
  await setup!.waitFor(
    () => setup!.renderer.currentFocusedRenderable?.id === "skills-filter-values",
  );
  expect(setup!.renderer.root.findDescendantById("skills-filter-overlay")).toBeDefined();
  expect(input.value).toBe("child");
  await setup!.mockInput.pressTab();
  await setup!.renderOnce();
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("skills-filter-clear-search");
  await setup!.mockInput.pressTab();
  await setup!.renderOnce();
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("skills-filter-close");
  await setup!.mockInput.pressTab();
  await setup!.renderOnce();
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("skills-filter-dimensions");
  await parsedEscape(setup!);
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "open-skills-filter");
});

test("Filter candidate viewport is independent of category count and applies descendants explicitly", async () => {
  await mount();
  const dimensions = setup!.renderer.root.findDescendantById(
    "skills-filter-dimensions",
  ) as SelectRenderable;
  const values = setup!.renderer.root.findDescendantById(
    "skills-filter-values",
  ) as SelectRenderable;
  expect(values.height).toBeGreaterThan(dimensions.options.length);
  await parsedEnter(setup!);
  expect(setup!.renderer.currentFocusedRenderable === values).toBe(true);
  values.setSelectedIndex(values.options.findIndex((option) => option.value === "parent"));
  await setup!.renderOnce();
  // A highlighted candidate is not yet applied; activation, not movement, changes the filter.
  const list = setup!.renderer.root.findDescendantById(
    "installed-skill-browser",
  ) as SelectRenderable;
  expect(list.options).toHaveLength(3);
  await parsedEnter(setup!);
  await setup!.renderOnce();
  expect(list.options).toHaveLength(2);
  expect(setup!.renderer.root.findDescendantById("clear-skills-filter-collection")).toBeDefined();
  await focusLive(setup!, "skills-filter-clear-all");
  await parsedEnter(setup!);
  await setup!.renderOnce();
  expect(setup!.renderer.root.findDescendantById("clear-skills-filter-collection")).toBeUndefined();
  expect(list.options).toHaveLength(3);
});

test("compact Filter retains control identities, input and modal containment on resize", async () => {
  await mount(80, 24);
  const input = setup!.renderer.root.findDescendantById("skills-filter-search") as InputRenderable;
  const values = setup!.renderer.root.findDescendantById(
    "skills-filter-values",
  ) as SelectRenderable;
  await focusLive(setup!, "skills-filter-search");
  setup!.mockInput.typeText("parent");
  await setup!.renderOnce();
  setup!.resize(43, 13);
  await setup!.renderOnce();
  expect(setup!.renderer.root.findDescendantById("skills-filter-search")).toBe(input);
  expect(setup!.renderer.root.findDescendantById("skills-filter-values")).toBe(values);
  expect(setup!.renderer.currentFocusedRenderable === input).toBe(true);
  expect(input.value).toBe("parent");
  const popup = setup!.renderer.root.findDescendantById("skills-filter-overlay")!;
  expect(values.screenY + values.height).toBeLessThanOrEqual(popup.screenY + popup.height - 1);
  expect(values.height).toBeGreaterThanOrEqual(1);
  await setup!.mockInput.pressTab({ shift: true });
  await setup!.renderOnce();
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("skills-filter-dimensions");
});
