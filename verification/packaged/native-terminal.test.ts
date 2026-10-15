import { expect, test } from "bun:test";
import { shellSelectionInvariants, TerminalScreen } from "./native-terminal";

test("native shell selection checks whitespace contexts and bounded sidebar or compact cues", () => {
  const clipped =
    "skill-cli [ Workspace   [ More actions… ]\n────\n[ Skills ] Collections\nWorkspace / Skills";
  expect(shellSelectionInvariants(clipped)).toMatchObject({
    selectedContextCount: 1,
    selectedSectionCount: 1,
  });
  expect(
    shellSelectionInvariants(clipped.replace("[ Workspace", "[ Workspace [ Local")),
  ).toMatchObject({ selectedContextCount: 2 });
  expect(shellSelectionInvariants(clipped.replace("[ Workspace", "Workspace"))).toMatchObject({
    selectedContextCount: 0,
  });
  const wide =
    " skill-cli [ Workspace ] Global\n────\n                     │ Workspace / Skills\n PAGES               │\n   ▶ Skills          │ ▶ Collections\n   Collections       │ [ Sources ]\nfooter\nfooter\nfooter";
  expect(shellSelectionInvariants(wide)).toMatchObject({
    selectedContextCount: 1,
    selectedSectionCount: 1,
    sectionCue: "sidebar",
  });
  expect(
    shellSelectionInvariants(wide.replace("   Collections       │", "   ▶ Collections     │")),
  ).toMatchObject({ selectedSectionCount: 2 });
  expect(
    shellSelectionInvariants(
      "skill-cli [ Project ]\n────\n[ Sources ] Collections\nProject Config / Sources",
    ),
  ).toMatchObject({
    selectedContextCount: 1,
    selectedSectionCount: 1,
    sectionCue: "compact-navigation",
  });
  expect(shellSelectionInvariants("Resize your terminal")).toEqual({ resizeOrModal: true });
  expect(shellSelectionInvariants("skill-cli [Workspace] [Local]\n────\n[Skills]")).toMatchObject({
    selectedContextCount: 2,
  });
});

test("native shell selection accepts Updates in sidebar and compact navigation cues", () => {
  const sidebar =
    " skill-cli [ Workspace ] Global\n────\n                     │ Workspace / Updates\n PAGES               │\n   ▶ Updates         │ ▶ Collections\nfooter\nfooter\nfooter";
  expect(shellSelectionInvariants(sidebar)).toMatchObject({
    selectedContextCount: 1,
    selectedSectionCount: 1,
    sectionCue: "sidebar",
  });

  const compact = "skill-cli [ Workspace ]\n────\n[ Updates ] Collections\nWorkspace / Updates";
  expect(shellSelectionInvariants(compact)).toMatchObject({
    selectedContextCount: 1,
    selectedSectionCount: 1,
    sectionCue: "compact-navigation",
  });
});

test("text-only terminal evidence does not invent selection counts for color-only tabs", () => {
  expect(
    shellSelectionInvariants(
      "skill-cli  Workspace  Global\n────\nSkills  Collections\nWorkspace / Skills",
    ),
  ).toMatchObject({
    selectedContextCount: null,
    selectedSectionCount: null,
    tabSelectionEvidence: "unavailable-in-text",
  });
  expect(
    shellSelectionInvariants(
      "skill-cli  Workspace  Global\n────\n │ Workspace / Skills\n PAGES               │\n   ▶ Skills          │\nfooter\nfooter\nfooter",
    ),
  ).toMatchObject({
    selectedContextCount: null,
    selectedSectionCount: 1,
  });
});

test("native screen tracks cursor moves, split ANSI/UTF-8, wide cells and combining text", () => {
  const screen = new TerminalScreen(40, 8);
  const bytes = new TextEncoder().encode("\x1b[2J\x1b[2;1H中Wide\r\néCombining\x1b[4;3H>Command<");
  for (const byte of bytes) screen.feed(new Uint8Array([byte]));
  expect(screen.locate("Wide")).toEqual({ column: 3, row: 2 });
  expect(screen.locate("Combining")).toEqual({ column: 2, row: 3 });
  expect(screen.locate(">Command<")).toEqual({ column: 3, row: 4 });
  screen.feed(new TextEncoder().encode("\x1b[1;1HCommand"));
  expect(screen.locate("Command", 1)).toEqual({ column: 1, row: 1 });
  screen.feed(new TextEncoder().encode("\x1b[4;3H\x1b[K"));
  expect(screen.locate("Command", 4)).toBeUndefined();
  screen.resize(43, 12);
  expect(screen.text().trim()).toBe("");
});
