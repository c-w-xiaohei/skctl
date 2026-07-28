import type { CoreFactoryOptions, SkillCliCore } from "./api";
import { createCatalog } from "./catalog";
import {
  changeConfiguration,
  previewAddToCollection,
  previewCollectionRemoval,
  previewCollectionUse,
  previewLinkChange,
  previewMembershipRemoval,
  previewImport,
  previewReference,
} from "./configuration";
import { createContent } from "./content";
import { getWorkspace } from "./workspace";
import { createManagement } from "./management";
export function createSkillCliCore(options: CoreFactoryOptions): SkillCliCore {
  return {
    workspace: { get: (operation) => getWorkspace(options, operation) },
    configuration: {
      change: (change, operation) => changeConfiguration(options, change, operation),
      previewAddToCollection: (request, operation) =>
        previewAddToCollection(options, request, operation),
      previewMembershipRemoval: (request, operation) =>
        previewMembershipRemoval(options, request, operation),
      previewImport: (request, operation) => previewImport(options, request, operation),
      previewReference: (request, operation) => previewReference(options, request, operation),
      previewLinkChange: (request, operation) => previewLinkChange(options, request, operation),
      previewCollectionUse: (request, operation) =>
        previewCollectionUse(options, request, operation),
      previewCollectionRemoval: (request, operation) =>
        previewCollectionRemoval(options, request, operation),
    },
    management: createManagement(options),
    catalog: createCatalog(options),
    content: createContent(options),
  };
}
