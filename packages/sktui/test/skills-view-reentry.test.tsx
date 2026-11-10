import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, directOwner } from "./direct-source.fixture";
import { readerProjection, readerAddress, readerSecondAddress } from "./installed-reader.fixture";
import { openMainPage } from "./main-page-controls";
import {
  enterLive,
  focusLive,
  filterUncollectedSkills,
  openAllInstalledSkills,
  openInstallation,
  openWorkspaceProblems,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";

const key = (address: { source: string; path: string }) =>
  JSON.stringify([address.source, address.path]);

for (const destination of ["agent", "sources", "membership", "problems", "skills"] as const) {
  test(`Skills retains query, checks, exact cursor and Reader preferences through ${destination}`, async () => {
    const base = readerProjection();
    const reads: string[] = [];
    const checks: string[] = [];
    const writes: string[] = [];
    const projection = {
      ...base,
      installedSkills: base.installedSkills.map((skill) => ({
        ...skill,
        description: `retained ${skill.description}`,
        collections:
          skill.address.path === "guide"
            ? [
                {
                  id: "team",
                  entry: "guide",
                  paths: [
                    {
                      kind: "direct" as const,
                      collection: "team",
                      entryName: "guide",
                      owner: directOwner,
                    },
                  ],
                },
              ]
            : [],
      })),
      diagnostics: [
        {
          severity: "warning" as const,
          code: "NOTICE",
          message: "Reference diagnostic",
          subject: { kind: "installed-skill" as const, address: readerSecondAddress },
        },
      ],
    };
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection, {
            loadInstalledSkill: async (_env, { address }) => {
              reads.push(key(address));
              return {
                address,
                name: address.path,
                description: "",
                markdownText: `# Reading ${address.path}`,
                rawText: `RAW-${address.path}`,
              };
            },
            checkUpdate: async (_env, { source }) => {
              checks.push(source);
              return {
                value: {
                  source,
                  kind: "github",
                  baseline: "test",
                  changed: [],
                  added: [],
                  removed: [],
                  unchanged: [],
                },
                diagnostics: [],
              };
            },
            installSkills: async () => {
              writes.push("install");
              return { value: [], diagnostics: [] };
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 80, height: 24 },
    );
    try {
      const browser = await openAllInstalledSkills(setup);
      setup.mockInput.pressKey(" ");
      await setup.flush();
      await focusLive(setup, "skills-query");
      await setup.mockInput.typeText("retained");
      await parsedEnter(setup);
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => browser.getSelectedOption()?.value === key(readerSecondAddress));
      await parsedEnter(setup);
      await waitForReaderBody(setup, "Reading reference");
      await enterLive(setup, "reader-more");
      await enterLive(setup, "reader-menu-raw");
      await openInstallation(setup);
      setup.resize(144, 24);
      await setup.flush();
      const priorReads = [...reads];
      if (destination === "membership") {
        await filterUncollectedSkills(setup);
        const filtered = setup.renderer.root.findDescendantById(
          "installed-skill-browser",
        ) as SelectRenderable;
        expect(filtered.options.map((option) => option.value)).toEqual([key(readerSecondAddress)]);
        await setSkillsFilter(setup, "Membership", "");
      } else if (destination === "problems") {
        await openWorkspaceProblems(setup);
        await parsedEscape(setup);
      } else {
        await openMainPage(setup, destination);
        if (destination === "agent") await openMainPage(setup, "sources");
        await openMainPage(setup, "skills");
      }
      await setup.flush();
      const restored = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      expect(restored.getSelectedOption()?.value).toBe(key(readerSecondAddress));
      expect(
        (setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value,
      ).toBe("retained");
      expect(
        restored.options
          .filter((option) => option.name.startsWith("✓"))
          .map((option) => option.value),
      ).toEqual([key(readerAddress)]);
      expect(!!setup.renderer.root.findDescendantById("reader-details")).toBe(true);
      expect(reads).toEqual(priorReads);
      expect(checks.every((source) => source === "team-main")).toBe(true);
      expect(checks.length).toBeLessThanOrEqual(1);
      expect(writes).toEqual([]);
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("Problems opens an exact Reader and Back restores diagnostics before the inventory", async () => {
  const base = readerProjection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...base,
          diagnostics: [
            {
              severity: "warning",
              code: "NOTICE",
              message: "Reference diagnostic",
              subject: { kind: "installed-skill", address: readerSecondAddress },
            },
          ],
        })}
        exit={() => {}}
      />
    ),
    { width: 144, height: 24 },
  );
  try {
    await openAllInstalledSkills(setup);
    await openWorkspaceProblems(setup);
    await enterLive(setup, "problems-browser");
    await waitForReaderBody(setup, "reference");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  } finally {
    setup.renderer.destroy();
  }
});
import { setSkillsFilter } from "./reader-test-controls";
