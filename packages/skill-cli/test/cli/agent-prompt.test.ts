import { describe, expect, test } from "bun:test";
import { renderAgentCatalog, unavailableCatalogPrompt } from "../../src/cli/agent-prompt";

describe("agent catalog prompt", () => {
  test("renders the complete CLI contract once for the root catalog", () => {
    const output = renderAgentCatalog({ kind: "root" }, [
      {
        kind: "skill",
        selector: 'alpha:deploy"x',
        name: "deploy now",
        description: "Deploy safely",
      },
      {
        kind: "collection",
        id: "team/release",
        name: "release",
        description: "Release workflows",
      },
    ]);
    expect(output).toContain('<managed_skill_catalog scope="root">');
    expect(output).toContain("<id>team/release</id>");
    expect(output).toContain('<selector>alpha:deploy"x</selector>');
    expect(output).toContain("load it before planning or answering");
    expect(output).toContain("Use only exact displayed IDs and selectors");
    expect(output).toContain("without reading CLI help");
    for (const command of [
      "skill-cli agent browse <collection-id>",
      "skill-cli agent load <selector>",
      "skill-cli agent read <selector> <root-relative-path>",
      "skill-cli agent download <selector> <root-relative-path> --output <host-path>",
      "skill-cli agent run <selector> -- <command> [args...]",
    ])
      expect(output).toContain(command);
  });

  test("renders collection catalogs compactly without repeating guidance", () => {
    const output = renderAgentCatalog({ kind: "collection", id: "alpha" }, [
      {
        kind: "skill",
        selector: "alpha:deploy",
        name: "deploy",
        description: "Deploy safely",
      },
    ]);
    expect(output).toBe(
      '<managed_skill_catalog scope="collection" id="alpha"><skill><selector>alpha:deploy</selector><name>deploy</name><description>Deploy safely</description></skill></managed_skill_catalog>\n',
    );
    expect(output).not.toContain("Managed Skills");
    expect(output).not.toContain("skill-cli agent");
  });

  test("renders empty and unavailable states", () => {
    expect(renderAgentCatalog({ kind: "root" }, [])).toContain(
      "No managed Skills are currently selected.",
    );
    expect(unavailableCatalogPrompt).toContain("managed catalog is unavailable");
  });
});
