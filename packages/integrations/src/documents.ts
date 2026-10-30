import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { getStaticTOMLValue, parseForESLint, type AST } from "toml-eslint-parser";
import { IntegrationError } from "./schema";

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function json(text: string, file: string): Record<string, unknown> {
  if (!text.trim()) return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || value === null || typeof value !== "object" || Array.isArray(value))
    throw new IntegrationError("INVALID_HOST_CONFIG", "Expected a JSON/JSONC object", file);
  return object(value);
}

export function editJson(text: string, path: (string | number)[], value: unknown): string {
  const source = text.trim() ? text : "{}\n";
  return applyEdits(
    source,
    modify(source, path, value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
        eol: text.includes("\r\n") ? "\r\n" : "\n",
      },
    }),
  );
}

export function toml(
  text: string,
  file: string,
): { ast: AST.TOMLProgram; value: Record<string, unknown> } {
  try {
    const { ast } = parseForESLint(text, { tomlVersion: "1.0" });
    return { ast, value: object(getStaticTOMLValue(ast)) };
  } catch {
    throw new IntegrationError("INVALID_HOST_CONFIG", "Cannot parse TOML configuration", file);
  }
}

export const same = (left: unknown, right: unknown): boolean => {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
};
