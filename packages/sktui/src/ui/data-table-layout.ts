export type DataTableCell =
  | string
  | {
      readonly text: string;
      readonly tone?: "neutral" | "muted" | "success" | "warning" | "danger";
    };

export interface DataTableColumn<T> {
  readonly id: string;
  readonly header: string;
  readonly cell: (row: T) => DataTableCell;
  readonly width?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly align?: "left" | "right";
  readonly optional?: boolean;
}

/** Header and body share these widths; the caller has already reserved its gutter. */
export function layoutTableColumns<T>(columns: readonly DataTableColumn<T>[], available: number) {
  const ids = new Set<string>();
  const visible = columns.map((column) => {
    if (ids.has(column.id)) throw new Error(`Duplicate column: ${column.id}`);
    ids.add(column.id);
    for (const field of ["width", "minWidth", "maxWidth"] as const) {
      const value = column[field];
      if (value !== undefined && (!Number.isInteger(value) || value < 1))
        throw new Error(`Column ${column.id}: ${field} must be a positive integer`);
    }
    const width = column.width ?? column.minWidth ?? Math.max(1, Bun.stringWidth(column.header));
    if (column.maxWidth !== undefined && column.maxWidth < width)
      throw new Error(`Column ${column.id}: maxWidth must accommodate its minimum width`);
    return {
      column,
      width,
    };
  });
  const minimum = () =>
    visible.reduce((total, item) => total + item.width, Math.max(0, visible.length - 1) * 2);
  for (let index = visible.length - 1; index >= 0 && minimum() > available; index--) {
    if (visible[index]!.column.optional) visible.splice(index, 1);
  }
  if (minimum() > available) return [];
  let flexible = visible.filter((item) => item.column.width === undefined);
  let spare = Math.max(0, Math.floor(available) - minimum());
  while (spare > 0 && flexible.length) {
    const share = Math.floor(spare / flexible.length);
    const extra = spare % flexible.length;
    flexible.forEach((item, index) => {
      const growth = Math.min(
        share + (index < extra ? 1 : 0),
        (item.column.maxWidth ?? Infinity) - item.width,
      );
      item.width += growth;
      spare -= growth;
    });
    flexible = flexible.filter((item) => item.width < (item.column.maxWidth ?? Infinity));
  }
  return visible;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Cell content is one terminal line, never a terminal control stream. */
export function truncateTableText(value: string, width: number): string {
  if (width < 1) return "";
  const text = value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ");
  if (Bun.stringWidth(text) <= width) return text;
  let result = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const size = Bun.stringWidth(segment);
    if (used + size > width - 1) break;
    result += segment;
    used += size;
  }
  return result + "…";
}
