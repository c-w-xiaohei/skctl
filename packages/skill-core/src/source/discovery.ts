import { decodeStrictText, parseSkillMetadata, type SkillMetadata } from "../content/text";
import { readdir, lstat, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { SkillCliError, type Diagnostic } from "../shared";

const fail = (code: SkillCliError["code"], message: string): never => {
  throw new SkillCliError(code, message);
};
export interface DiscoveredSkill extends SkillMetadata {
  readonly root: string;
  readonly relativeRoot: string;
}

export async function discoverLocalSkills(
  root: string,
): Promise<{ skills: readonly DiscoveredSkill[]; diagnostics: readonly Diagnostic[] }> {
  const skills: DiscoveredSkill[] = [];
  const diagnostics: Diagnostic[] = [];
  const names = new Set<string>();
  async function walk(directory: string): Promise<void> {
    const skillFile = resolve(directory, "SKILL.md");
    try {
      const stat = await lstat(skillFile);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        try {
          const text = decodeStrictText(await readFile(skillFile));
          const { name, description } = parseSkillMetadata(text);
          if (names.has(name)) fail("DUPLICATE_SKILL_NAME", `Duplicate Skill name: ${name}`);
          names.add(name);
          skills.push({
            root: directory,
            relativeRoot: relative(root, directory).split(sep).join("/"),
            name,
            description,
          });
        } catch (error) {
          if (error instanceof SkillCliError && error.code === "DUPLICATE_SKILL_NAME") throw error;
          diagnostics.push({
            code: "SKILL_FRONTMATTER_INVALID",
            severity: "warning",
            message: "Malformed SKILL.md",
            location: { file: skillFile },
          });
        }
        return;
      }
    } catch (error) {
      if (error instanceof SkillCliError) throw error;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name))))
      if (entry.isDirectory() && !entry.isSymbolicLink())
        await walk(resolve(directory, entry.name));
  }
  await walk(root);
  return { skills, diagnostics };
}
