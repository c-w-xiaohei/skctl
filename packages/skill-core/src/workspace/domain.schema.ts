import * as v from "valibot";
import { diagnosticSchema } from "../shared";
import { configDeclarationOwnerSchema as owner, configLevelSchema } from "../config/schema";
import { configSourceViewSchema } from "../config/domain.schema";
import { sourceBindingViewSchema, skillSourceRefSchema } from "../source/domain.schema";
import { skillAddressSchema } from "../source/schema";
import { skillMetadataSchema } from "../content/domain.schema";
import { collectionViewSchema, memberOriginPathSchema } from "../collection/domain.schema";
import { managedAgentViewSchema } from "../catalog/domain.schema";

const strings = v.pipe(v.array(v.string()), v.readonly()),
  owners = v.pipe(v.array(owner), v.readonly()),
  diagnostics = v.pipe(v.array(diagnosticSchema), v.readonly()),
  paths = v.pipe(v.array(memberOriginPathSchema), v.readonly());
export const configFileViewSchema = v.object({
  status: v.picklist(["missing", "valid", "invalid", "unreadable"]),
  file: v.string(),
  problem: v.optional(diagnosticSchema),
});
export const configLevelViewSchema = v.object({
  level: configLevelSchema,
  file: configFileViewSchema,
  direct: v.object({
    sources: v.pipe(
      v.array(
        v.object({
          ...v.omit(sourceBindingViewSchema, ["ref"]).entries,
          ref: skillSourceRefSchema,
          trackedRef: v.optional(v.string()),
        }),
      ),
      v.readonly(),
    ),
    configSources: v.pipe(v.array(configSourceViewSchema), v.readonly()),
    collections: configSourceViewSchema.entries.contributed.entries.collections,
    collectionUse: v.pipe(v.array(v.object({ collection: v.string(), owner })), v.readonly()),
    integrations: v.pipe(v.array(v.object({ kind: v.literal("opencode"), owner })), v.readonly()),
  }),
  contributed: v.object({
    sources: v.pipe(v.array(sourceBindingViewSchema), v.readonly()),
    collections: strings,
  }),
});
export const installedSkillSelectorViewsSchema = v.variant("status", [
  v.object({
    status: v.literal("complete"),
    values: v.pipe(
      v.array(
        v.object({
          selector: v.string(),
          collection: v.string(),
          entry: v.string(),
          paths,
          exposurePaths: v.optional(
            v.pipe(
              v.array(
                v.object({
                  owner,
                  segments: v.pipe(
                    v.array(
                      v.object({
                        collection: v.string(),
                        reference: v.optional(v.object({ name: v.string(), target: v.string() })),
                      }),
                    ),
                    v.readonly(),
                  ),
                }),
              ),
              v.readonly(),
            ),
          ),
          useOwners: owners,
        }),
      ),
      v.readonly(),
    ),
  }),
  v.object({ status: v.literal("unavailable") }),
]);
const effective = {
  sources: v.pipe(v.array(sourceBindingViewSchema), v.readonly()),
  collections: strings,
  agent: managedAgentViewSchema,
};
export const workspaceViewSchema = v.object({
  project: v.object({
    root: v.string(),
    resolution: v.picklist(["explicit", "nearest-config", "git-root", "global-only"]),
  }),
  configs: v.pipe(v.array(configLevelViewSchema), v.readonly()),
  effective: v.variant("status", [
    v.object({
      ...effective,
      status: v.literal("complete"),
      use: strings,
      managed: v.boolean(),
      collectionsView: v.pipe(v.array(collectionViewSchema), v.readonly()),
    }),
    v.object({ ...effective, status: v.literal("unavailable"), reasons: diagnostics }),
  ]),
  installedSkills: v.pipe(
    v.array(
      v.object({
        ...skillMetadataSchema.entries,
        address: skillAddressSchema,
        owner: v.object({
          source: v.string(),
          health: v.picklist(["healthy", "missing", "drifted", "unresolved-config"]),
          relevantLocalRoot: v.optional(v.string()),
          relevantRemoteRevision: v.optional(v.string()),
        }),
        source: v.optional(sourceBindingViewSchema),
        collections: v.pipe(
          v.array(v.object({ id: v.string(), entry: v.string(), paths })),
          v.readonly(),
        ),
        selectors: strings,
        selectorViews: installedSkillSelectorViewsSchema,
        primary: v.optional(v.string()),
        aliases: strings,
        problems: diagnostics,
      }),
    ),
    v.readonly(),
  ),
  diagnostics,
});
