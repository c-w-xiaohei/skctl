import { SkctlError } from "../shared";
import * as v from "valibot";
import { resourcePathSchema } from "./domain.schema";

const fail = (code: SkctlError["code"], message: string): never => {
  throw new SkctlError(code, message);
};
export function parseResourcePath(value: string): string {
  if (!v.is(resourcePathSchema, value))
    return fail("INVALID_RESOURCE_PATH", "Invalid resource path");
  return value;
}
