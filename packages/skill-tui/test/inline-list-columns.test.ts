import { expect, test } from "bun:test";
import { formatColumns, inlineNameColumnWidth } from "../src/ui/list-text";

test("inline list columns never exceed their terminal cell budget", () => {
  for (const width of [6, 7, 8, 12, 30, 40, 60]) {
    const row = formatColumns("domain-authority-auditor", "path: seo-geo", width, 28);
    expect(Bun.stringWidth(row)).toBeLessThanOrEqual(Math.max(1, width - 5));
  }
});

test("inline fitting does not split CJK characters and keeps primary identity readable", () => {
  const row = formatColumns("domain-authority-auditor", "text: SEO 优化", 45, 26);
  expect(row).toContain("domain-authority-auditor");
  expect(Bun.stringWidth(row)).toBeLessThanOrEqual(40);
});

test("100-column split preserves a 24-cell Skill name instead of giving that space to metadata", () => {
  const width = 38;
  expect(inlineNameColumnWidth(width)).toBe(24);
  expect(
    formatColumns("domain-authority-auditor", "path: seo", width, inlineNameColumnWidth(width)),
  ).toContain("domain-authority-auditor");
});
