import { describe, expect, test } from "bun:test";
import { UNAVAILABLE_NOTICE, renderCatalog } from "../src/prompt.ts";

const entry = {
  kind: "skill" as const,
  selector: 'alpha:deploy"x',
  name: "deploy\nnow",
  description: "Use \\ safely",
};
const collection = {
  kind: "collection" as const,
  id: "team/release",
  name: "release",
  description: "Release safely",
};

describe("catalog prompt", () => {
  test("renders collection and Skill nodes with exact commands", () => {
    const output = renderCatalog({ kind: "collection", id: "alpha" }, [entry, collection]);
    expect(output).toContain(JSON.stringify(entry));
    for (const command of [
      "skill-cli agent browse <collection-id>",
      "skill-cli agent load <selector>",
      "skill-cli agent read <selector> <root-relative-path>",
      "skill-cli agent download <selector> <root-relative-path> --output <host-path>",
      "skill-cli agent run <selector> -- <command> [args...]",
    ])
      expect(output).toContain(command);
    expect(output).not.toContain("provenance");
  });

  test("renders concise empty state and rejects malformed or oversized records", () => {
    expect(renderCatalog({ kind: "root" }, [])).toContain(
      "No managed Skills are currently selected.",
    );
    expect(() => renderCatalog({ kind: "root" }, [{ ...entry, selector: "" }])).toThrow(
      "RENDER_INVALID",
    );
    expect(() => renderCatalog({ kind: "root" }, [{ ...collection, id: "" }])).toThrow(
      "RENDER_INVALID",
    );
    expect(() =>
      renderCatalog(
        { kind: "root" },
        Array.from({ length: 5_000 }, () => entry),
      ),
    ).toThrow("RENDER_TOO_LARGE");
  });

  test("exports the exact unavailable notice", () => {
    expect(UNAVAILABLE_NOTICE).toBe(
      "skill-cli managed catalog is unavailable for this request. Do not invent managed Skills; continue without it or report the unavailable catalog.",
    );
  });
});
