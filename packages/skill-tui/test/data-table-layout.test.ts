import { expect, test } from "bun:test";
import { layoutTableColumns, truncateTableText } from "../src/ui/data-table-layout";

const columns = [
  { id: "name", header: "Name", cell: (row: string) => row, minWidth: 12 },
  { id: "status", header: "Status", cell: () => "Ready", width: 10 },
  { id: "count", header: "Count", cell: () => "120", width: 5, optional: true },
];

test("table column layout shares exact widths, fills flexible columns and drops optional columns first", () => {
  const wide = layoutTableColumns(columns, 40);
  expect(wide.map(({ column, width }) => [column.id, width])).toEqual([
    ["name", 21],
    ["status", 10],
    ["count", 5],
  ]);
  const narrow = layoutTableColumns(columns, 24);
  expect(narrow.map(({ column, width }) => [column.id, width])).toEqual([
    ["name", 12],
    ["status", 10],
  ]);
  expect(layoutTableColumns(columns, 20)).toEqual([]);
  expect(layoutTableColumns(columns, 0)).toEqual([]);
  expect(layoutTableColumns([], 40)).toEqual([]);
});

test("table layout distributes integer spare cells without changing fixed widths", () => {
  const flexible = [columns[0]!, { ...columns[0]!, id: "other" }, columns[1]!];
  const widths = layoutTableColumns(flexible, 41).map((item) => item.width);
  expect(widths).toEqual([14, 13, 10]);
  expect(widths.reduce((total, width) => total + width, 4)).toBe(41);
});

test("bounded identity columns keep neighboring status close and redistribute space only to uncapped columns", () => {
  const bounded = { ...columns[0]!, maxWidth: 20 };
  expect(layoutTableColumns([bounded, columns[1]!], 100).map((item) => item.width)).toEqual([
    20, 10,
  ]);
  expect(
    layoutTableColumns([bounded, { ...columns[0]!, id: "description" }, columns[1]!], 80).map(
      (item) => item.width,
    ),
  ).toEqual([20, 46, 10]);
  expect(layoutTableColumns([bounded, columns[1]!], 24).map((item) => item.width)).toEqual([
    12, 10,
  ]);
  expect(() => layoutTableColumns([{ ...bounded, maxWidth: 4 }], 100)).toThrow("maxWidth");
});

test("table layout rejects ambiguous or invalid column definitions", () => {
  expect(() => layoutTableColumns([columns[0]!, columns[0]!], 80)).toThrow("Duplicate column");
  expect(() => layoutTableColumns([{ ...columns[0]!, width: -1 }], 80)).toThrow("width");
  expect(() => layoutTableColumns([{ ...columns[0]!, minWidth: Number.NaN }], 80)).toThrow(
    "minWidth",
  );
});

test("table truncation preserves grapheme clusters and fits actual terminal columns", () => {
  expect(truncateTableText("你好世界", 5)).toBe("你好…");
  expect(truncateTableText("e\u0301abc", 2)).toBe("e\u0301…");
  const family = "👨‍👩‍👧‍👦";
  const clusterWidth = Bun.stringWidth(family);
  expect(truncateTableText(`${family}abcd`, clusterWidth + 1)).toBe(`${family}…`);
  expect(truncateTableText("abcdef", 1)).toBe("…");
  expect(truncateTableText("abcdef", 0)).toBe("");
  expect(truncateTableText("line\nnext\tcell", 40)).toBe("line next cell");
  expect(truncateTableText("\u001b[31mred", 40)).not.toContain("\u001b");
});
