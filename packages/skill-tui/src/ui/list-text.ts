/** Align terminal columns without cutting a wide character in half. */
export function fitColumn(value: string, width: number): string {
  const available = Math.max(1, width);
  if (Bun.stringWidth(value) <= available)
    return value + " ".repeat(available - Bun.stringWidth(value));
  let result = "";
  let used = 0;
  for (const character of value) {
    const size = Bun.stringWidth(character);
    if (used + size > available - 1) break;
    result += character;
    used += size;
  }
  return result + "…" + " ".repeat(Math.max(0, available - used - 1));
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
