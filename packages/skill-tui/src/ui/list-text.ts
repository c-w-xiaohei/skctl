import { truncateTableText } from "./data-table-layout";

/** Align single-line terminal columns without splitting a grapheme cluster. */
export function fitColumn(value: string, width: number): string {
  const available = Math.max(1, width);
  const text = truncateTableText(value, available);
  return text + " ".repeat(Math.max(0, available - Bun.stringWidth(text)));
}

export function formatColumns(
  left: string,
  right: string,
  width: number,
  leftWidth: number,
): string {
  const available = Math.max(1, width - 5);
  if (available < 4) return fitColumn(left, available);
  const first = Math.min(Math.max(1, leftWidth), Math.max(1, available - 3));
  return `${fitColumn(left, first)}  ${fitColumn(right, available - first - 2)}`;
}

export function inlineNameColumnWidth(width: number): number {
  return Math.min(28, Math.max(1, width - 14));
}
