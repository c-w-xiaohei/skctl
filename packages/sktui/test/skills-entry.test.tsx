import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  enterLive,
  parsedEscape,
  openAllInstalledSkills,
  parsedEnter,
} from "./reader-test-controls";
import { filterSkills } from "../src/skills-filter";
import { openMainPage } from "./main-page-controls";
import { openWorkspaceProblems } from "./reader-test-controls";
import { mkdir, writeFile } from "node:fs/promises";

test("Skills opens the inventory without view tabs and Problems returns to it", async () => {
  const base = readerProjection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...base,
          diagnostics: [{ code: "TEST", message: "Workspace issue", severity: "warning" }],
        })}
        exit={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("skills-local-views")).toBe(false);
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
    expect(browser.height).toBeGreaterThanOrEqual(6);
    const problems = setup.renderer.root.findDescendantById("workspace-problems")!;
    expect(problems.screenX + problems.width).toBeLessThanOrEqual(43);
    await mkdir("out/skills-entry", { recursive: true });
    await writeFile("out/skills-entry/inventory-43x13.txt", setup.captureCharFrame());
    await enterLive(setup, "workspace-problems");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("problems-browser"));
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  } finally {
    setup.renderer.destroy();
  }
});

for (const page of ["collections", "sources", "updates", "agent", "settings"] as const) {
  test(`global Problems returns to the originating ${page} page`, async () => {
    const base = readerProjection();
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore({
            ...base,
            diagnostics: [{ code: "TEST", message: "Workspace issue", severity: "warning" }],
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 24 },
    );
    try {
      await openMainPage(setup, page);
      await openWorkspaceProblems(setup);
      await parsedEscape(setup);
      const tab = setup.renderer.root.findDescendantById(
        `shell-section-tab-${page}`,
      ) as TabsTabRenderable;
      expect(tab.getState().selected).toBe(true);
      expect(!!setup.renderer.root.findDescendantById("problems-browser")).toBe(false);
      expect(setup.captureCharFrame()).not.toContain("Workspace issue");
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("Actions can open empty diagnostics without a persistent problem badge", async () => {
  const base = readerProjection();
  const setup = await testRender(() => <App core={directSourceCore(base)} exit={() => {}} />, {
    width: 43,
    height: 13,
  });
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect(!!setup.renderer.root.findDescendantById("workspace-problems")).toBe(false);
    await openWorkspaceProblems(setup);
    expect(setup.captureCharFrame()).toContain("No Problems");
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  } finally {
    setup.renderer.destroy();
  }
});

test("Skills breadcrumb leaves global Problems for inventory rather than its originating page", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await openMainPage(setup, "sources");
    await openWorkspaceProblems(setup);
    await enterLive(setup, "breadcrumb-0");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(
      (
        setup.renderer.root.findDescendantById("shell-section-tab-skills") as TabsTabRenderable
      ).getState().selected,
    ).toBe(true);
    expect(setup.renderer.root.findDescendantById("problems-browser")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("Agent breadcrumb returns from a connection to its host list", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openMainPage(setup, "agent");
    await enterLive(setup, "agent-view-tab-global");
    await enterLive(setup, "integration-hosts");
    await enterLive(setup, "breadcrumb-1");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "integration-hosts");
    expect(setup.renderer.root.findDescendantById("agent-view-tab-global")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("breadcrumb root returns from the Reader and Back sits beside the path below Pages", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 43, height: 13 },
  );
  try {
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    const back = setup.renderer.root.findDescendantById("route-back")!;
    const path = setup.renderer.root.findDescendantById("workspace-breadcrumbs")!;
    expect(back.screenY).toBe(1);
    expect(path.screenY).toBe(back.screenY);
    expect(path.screenX + path.width).toBeLessThanOrEqual(back.screenX);
    await enterLive(setup, "breadcrumb-0");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.renderer.root.findDescendantById("route-back")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("membership filtering composes with query and source without changing Agent availability", () => {
  const [first, second] = readerProjection().installedSkills;
  const skills = [
    { ...first!, collections: [] },
    {
      ...second!,
      collections: [
        {
          id: "team",
          entry: "reference",
          paths: [
            {
              kind: "repository-derived" as const,
              repository: "team",
              source: second!.address.source,
              path: second!.address.path,
            },
          ],
        },
      ],
    },
  ];
  expect(
    filterSkills(skills, { filters: { Membership: "Not in a Collection" } }).map(
      (item) => item.address,
    ),
  ).toEqual([first!.address]);
  expect(
    filterSkills(skills, { filters: { Membership: "Not in a Collection" }, query: second!.name }),
  ).toEqual([]);
  expect(
    filterSkills(skills, { filters: { Membership: "Not in a Collection" }, source: "other" }),
  ).toEqual([]);
});
