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
