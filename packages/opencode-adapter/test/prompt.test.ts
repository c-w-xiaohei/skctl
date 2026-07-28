import { describe, expect, test } from "bun:test";
import { UNAVAILABLE_NOTICE, renderCatalog } from "../src/prompt.ts";

const entry = {
  selector: 'alpha:deploy"x',
  name: "deploy\nnow",
  description: "Use \\ safely",
};
const reference = { name: "release", description: "Release safely", collection: "team/release" };

describe("catalog prompt", () => {
  test("renders direct skills, category references, and clean commands", () => {
    const output = renderCatalog([entry], [reference]);
    expect(output).toContain(
      JSON.stringify({
        selector: entry.selector,
        name: entry.name,
        description: entry.description,
      }),
    );
    for (const command of [
      "skill-cli agent list <collection>",
      "skill-cli agent load <selector>",
      "skill-cli agent read <selector> <root-relative-path>",
      "skill-cli agent download <selector> <root-relative-path> --output <host-path>",
      "skill-cli agent run <selector> -- <command> [args...]",
    ])
      expect(output).toContain(command);
    expect(output).not.toContain("provenance");
  });

  test("renders concise empty state and rejects malformed or oversized records", () => {
    expect(renderCatalog([], [])).toContain("No managed Skills are currently selected.");
    expect(() => renderCatalog([{ ...entry, selector: "" }], [])).toThrow("RENDER_INVALID");
    expect(() => renderCatalog([], [{ ...reference, collection: "" }])).toThrow("RENDER_INVALID");
    expect(() =>
      renderCatalog(
        Array.from({ length: 5_000 }, () => entry),
        [],
      ),
    ).toThrow("RENDER_TOO_LARGE");
  });

  test("exports the exact unavailable notice", () => {
    expect(UNAVAILABLE_NOTICE).toBe(
      "skill-cli managed catalog is unavailable for this request. Do not invent managed Skills; continue without it or report the unavailable catalog.",
    );
  });
});
