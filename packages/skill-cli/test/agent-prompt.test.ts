import { expect, test } from "bun:test";
import { renderAgentCatalog } from "../src/agent-prompt";

test("root catalog carries discovery and resource instructions for direct system injection", () => {
  const output = renderAgentCatalog({ kind: "root" }, [
    { kind: "collection", id: "team", name: "team", description: "Engineering workflows" },
  ]);
  expect(output).toContain(
    "Collection descriptions route discovery; only loaded Skills contain task instructions.",
  );
  for (const command of [
    "browse <collection-id>",
    "load <selector>",
    "read <selector>",
    "download <selector>",
    "run <selector>",
  ])
    expect(output).toContain(`skill-cli agent ${command}`);
  expect(output).toContain(
    '<managed_skill_catalog scope="root"><collection><id>team</id><name>team</name><description>Engineering workflows</description></collection></managed_skill_catalog>',
  );
});

test("collection catalog preserves typed hierarchy without repeating root instructions", () => {
  expect(
    renderAgentCatalog({ kind: "collection", id: "team" }, [
      { kind: "skill", selector: "team:entry", name: "code-review", description: "Review changes" },
      { kind: "collection", id: "team/security", name: "security checks", description: "Security" },
    ]),
  ).toBe(
    '<managed_skill_catalog scope="collection" id="team"><skill><selector>team:entry</selector><name>code-review</name><description>Review changes</description></skill><collection><id>team/security</id><name>security checks</name><description>Security</description></collection></managed_skill_catalog>\n',
  );
});

test("metadata cannot close XML nodes or alter scope attributes", () => {
  const output = renderAgentCatalog({ kind: "collection", id: 'team"&' }, [
    {
      kind: "skill",
      selector: "team:entry",
      name: "code-review",
      description: 'Use <review> & "compare" </description></skill>',
    },
  ]);
  expect(output).toBe(
    '<managed_skill_catalog scope="collection" id="team&quot;&amp;"><skill><selector>team:entry</selector><name>code-review</name><description>Use &lt;review&gt; &amp; &quot;compare&quot; &lt;/description&gt;&lt;/skill&gt;</description></skill></managed_skill_catalog>\n',
  );
});

test("empty root retains onboarding and an explicit empty catalog", () => {
  const output = renderAgentCatalog({ kind: "root" }, []);
  expect(output).toContain("skill-cli agent browse <collection-id>");
  expect(output).toContain(
    '<managed_skill_catalog scope="root">No managed Collections are currently exposed.</managed_skill_catalog>',
  );
});

test("an empty collection reports its own available contents without root onboarding", () => {
  expect(renderAgentCatalog({ kind: "collection", id: "team" }, [])).toBe(
    '<managed_skill_catalog scope="collection" id="team">No Skills or referenced Collections are available in this Collection.</managed_skill_catalog>\n',
  );
});

test("oversized catalog fails rather than silently omitting candidates", () => {
  expect(() =>
    renderAgentCatalog({ kind: "root" }, [
      { kind: "collection", id: "team", name: "team", description: "x".repeat(65536) },
    ]),
  ).toThrow("Catalog prompt is too large");
});
