import { SkctlError } from "../shared";

const fail = (code: SkctlError["code"], message: string): never => {
  throw new SkctlError(code, message);
};
export function parseResourcePath(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    return fail("INVALID_RESOURCE_PATH", "Invalid resource path");
  return value;
}
