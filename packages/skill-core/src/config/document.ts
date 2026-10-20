import {
  configSchemaFor,
  reusableConfigSchema,
  type ConfigDocument,
  type ReusableConfigDocument,
} from "./schema";
import * as v from "valibot";
import { lstat, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import type { ConfigLevel } from "./types";
import type { SourceBinding } from "../source/schema";
import { sourceRootSchema } from "../source/schema";
import type { Diagnostic } from "../shared";
import { SkctlError } from "../shared";
import { canonicalLocalOrigin, canonicalRemoteOrigin } from "../source/identity";
import { parseQualifiedName } from "../collection/names";
import { textLimit } from "../content/text";

let configReadHook: ((path: string) => void) | undefined;
/** Test-only observation of concrete Config bytes captured for one workspace projection. */
export function setConfigReadHookForTest(next?: (path: string) => void) {
  configReadHook = next;
}
type DocumentScope = ConfigLevel | "reusable";

export async function document(path: string, scope: DocumentScope): Promise<ConfigDocument> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? undefined : Promise.reject(error),
  );
  if (!stat) return {};
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new SkctlError("CONFIG_SYMLINK", `Configuration file is not an ordinary file: ${path}`);
  const bytes = await readFile(path);
  configReadHook?.(path);
  if (bytes.byteLength > textLimit)
    throw new SkctlError("TEXT_TOO_LARGE", "Configuration exceeds text limit");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SkctlError("INVALID_UTF8", "Configuration is not UTF-8");
  }
  return parseDocument(text, path, scope);
}
export function parseDocument(text: string, path: string, scope: DocumentScope): ConfigDocument {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length)
    throw invalidConfig(path, "Configuration syntax is invalid", `/@${errors[0]!.offset}`);
  const result = v.safeParse(configSchemaFor(scope), value);
  if (!result.success) {
    const error = result.issues[0];
    const pointer = error.path?.map((item) => `/${pointerSegment(String(item.key))}`).join("");
    throw invalidConfig(path, `Configuration ${error.message}`, pointer);
  }
  validateDocumentNames(result.output, path);
  validateDocumentBindings(result.output, path, scope === "reusable");
  return result.output;
}
export function invalidConfig(
  path: string,
  message: string,
  pointer?: string,
  related?: Diagnostic["related"],
): SkctlError {
  return new SkctlError("CONFIG_INVALID", message, [
    {
      code: "CONFIG_INVALID",
      severity: "warning",
      message,
      location: { file: path, ...(pointer ? { pointer } : {}) },
      ...(related ? { related } : {}),
    },
  ]);
}
export function validateDocumentNames(value: ConfigDocument, path: string): void {
  const validate = (id: string, pointer: string) => {
    try {
      parseQualifiedName(id);
    } catch (error) {
      throw invalidConfig(
        path,
        error instanceof SkctlError ? error.message : "Invalid qualified name",
        pointer,
      );
    }
  };
  for (const id of Object.keys(value.sources ?? {})) validate(id, `/sources/${pointerSegment(id)}`);
  for (const id of Object.keys(value.configSources ?? {}))
    validate(id, `/configSources/${pointerSegment(id)}`);
  for (const id of Object.keys(value.collections ?? {}))
    validate(id, `/collections/${pointerSegment(id)}`);
  for (const [index, id] of (value.use ?? []).entries()) validate(id, `/use/${index}`);
}
export function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
export function bindingProblemPointer(binding: SourceBinding, pointer: string): string {
  if (binding.kind === "local") return `${pointer}/path`;
  return `${pointer}/origin`;
}
function validateBinding(binding: SourceBinding, file: string, pointer: string): void {
  try {
    validateSourceRoot(binding.root);
    if (binding.kind === "local") canonicalLocalOrigin(binding.path, dirname(file));
    else {
      const origin =
        binding.kind === "github" && binding.origin.match(/^[^/]+\/[^/]+$/u)
          ? `https://github.com/${binding.origin}`
          : binding.origin;
      canonicalRemoteOrigin(origin);
    }
  } catch (error) {
    if (!(error instanceof SkctlError)) throw error;
    const location =
      error.message === "Source Root must be a relative normalized path"
        ? `${pointer}/root`
        : bindingProblemPointer(binding, pointer);
    throw invalidConfig(file, error.message, location);
  }
}
export function validateDocumentBindings(
  value: ConfigDocument,
  file: string,
  reusable: boolean,
): void {
  for (const [id, binding] of Object.entries(value.sources ?? {})) {
    const pointer = `/sources/${pointerSegment(id)}`;
    if (reusable) {
      try {
        validateSourceRoot(binding.root);
      } catch (error) {
        if (!(error instanceof SkctlError)) throw error;
        throw invalidConfig(file, error.message, `${pointer}/root`);
      }
    } else validateBinding(binding, file, pointer);
  }
  if (reusable) return;
  for (const [id, binding] of Object.entries(value.configSources ?? {}))
    validateBinding(binding, file, `/configSources/${pointerSegment(id)}`);
}
export function validateSourceRoot(root: string): void {
  if (!v.is(sourceRootSchema, root))
    throw new SkctlError("CONFIG_INVALID", "Source Root must be a relative normalized path");
}
export function validateConfigBytes(bytes: Uint8Array): ReusableConfigDocument {
  const text = decodeConfig(bytes, "Remote Config");
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !v.is(reusableConfigSchema, value))
    throw new SkctlError("CONFIG_INVALID", "Invalid Remote Config");
  validateDocumentNames(value, "Remote Config");
  validateDocumentBindings(value, "Remote Config", true);
  return value;
}
export function edit(text: string, path: (string | number)[], value: unknown) {
  return applyEdits(
    text,
    modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
  );
}
export function decodeConfig(bytes: Uint8Array, path: string) {
  if (bytes.byteLength > textLimit)
    throw new SkctlError("TEXT_TOO_LARGE", "Configuration exceeds text limit");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SkctlError("INVALID_UTF8", `Configuration is not UTF-8: ${path}`);
  }
}
