import { expect, test } from "bun:test";
import { fitColumn } from "../src/ui/list-text";

test("list columns preserve grapheme boundaries, terminal width and single-line safety", () => {
  const samples = ["中文内容", "éééé", "👨‍👩‍👧‍👦团队", "🇨🇳🇫🇷旗帜", "✈️旅行"];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const text of samples) {
    const prefixes = new Set([""]);
    let prefix = "";
    for (const { segment } of segmenter.segment(text)) {
      prefix += segment;
      prefixes.add(prefix);
    }
    for (let width = 1; width <= 12; width++) {
      const result = fitColumn(text, width);
      expect(Bun.stringWidth(result)).toBe(width);
      expect(prefixes.has(result.trimEnd().replace(/…$/, ""))).toBe(true);
    }
  }
  const sanitized = fitColumn("name\n\x1b[31m", 20);
  expect(sanitized).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u);
  expect(Bun.stringWidth(sanitized)).toBe(20);
});
