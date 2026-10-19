import { SkctlError } from "../shared";

const fail = (code: SkctlError["code"], message: string): never => {
  throw new SkctlError(code, message);
};
export function parseNameSegment(value: string, normalizeNfc = true): string {
  const n = value.normalize("NFC");
  if (
    (!normalizeNfc && n !== value) ||
    Buffer.byteLength(n) > 128 ||
    n.length === 0 ||
    n === "." ||
    n === ".." ||
    [...n].some(
      (character) =>
        /\s/u.test(character) ||
        character.codePointAt(0)! < 32 ||
        character.codePointAt(0) === 127 ||
        ":\\/#".includes(character),
    )
  )
    return fail("INVALID_ARGUMENT", "Invalid Name Segment");
  return n;
}

export function parseQualifiedName(value: string): string {
  const segments = value.split("/");
  if (segments.length === 0 || segments.some((segment) => !segment))
    return fail("INVALID_ARGUMENT", "Invalid qualified name");
  return segments.map((segment) => parseNameSegment(segment)).join("/");
}

export function parseSelector(value: string): { source: string; skill: string } {
  if ((value.match(/:/g) ?? []).length !== 1)
    return fail("INVALID_ARGUMENT", "Invalid Skill Selector");
  const [source, skill] = value.split(":");
  return { source: parseQualifiedName(source!), skill: parseNameSegment(skill!) };
}
