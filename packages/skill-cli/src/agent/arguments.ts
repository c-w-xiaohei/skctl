import { InvalidArgumentError } from "commander";

export function collectionId(value: string): string {
  if (!value || value.includes(":"))
    throw new InvalidArgumentError("Expected Collection ID, not a Skill Selector");
  return value;
}

export function skillSelector(value: string): string {
  if (!value || (value.match(/:/g) ?? []).length !== 1)
    throw new InvalidArgumentError(
      "Expected Skill Selector in <collection-id>:<entry-name> format",
    );
  return value;
}
