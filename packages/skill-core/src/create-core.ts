import type { CoreFactoryOptions } from "./shared";
import type { SkillCliCore } from "./api";
import { createCatalog } from "./catalog/query";
import {
  previewAddToCollection,
  previewCollectionRemoval,
  previewCollectionUse,
  previewLinkChange,
  previewMembershipRemoval,
  previewMembershipBatch,
  previewImport,
  previewAddReference,
  previewRemoveReference,
} from "./collection/preview";
import { createContent, createInstalledContent } from "./content/operations";
import { getWorkspace } from "./workspace/query";
import { createSources } from "./source/lifecycle";
import { createConfigSources } from "./config/lifecycle";
import { createInstalled } from "./installed/lifecycle";
import { gc } from "./storage/gc";
import { registerSource, registerConfigSource, setManagedOpenCode } from "./config/register";
import { createUpdates } from "./installed/update";
import * as edits from "./collection/edit";
import { setUse, addUse, removeUse } from "./collection/use";
import { inspectCollection } from "./collection/inspect";
export function createSkillCliCore(options: CoreFactoryOptions): SkillCliCore {
  return {
    workspace: { get: (operation) => getWorkspace(options, operation) },
    collections: {
      inspect: (request, operation) => inspectCollection(options, request, operation),
      create: (request, operation) => edits.createCollection(options, request, operation),
      remove: (request, operation) => edits.removeCollection(options, request, operation),
      addMember: (request, operation) => edits.addMember(options, request, operation),
      removeMember: (request, operation) => edits.removeMember(options, request, operation),
      editMembers: (request, operation) => edits.editMembers(options, request, operation),
      importMembers: (request, operation) => edits.importMembers(options, request, operation),
      addReference: (request, operation) => edits.addReference(options, request, operation),
      removeReference: (request, operation) => edits.removeReference(options, request, operation),
      setLink: (request, operation) => edits.setLink(options, request, operation),
      previewAddMember: (request, operation) => previewAddToCollection(options, request, operation),
      previewRemoveMember: (request, operation) =>
        previewMembershipRemoval(options, request, operation),
      previewMemberEdit: (request, operation) =>
        previewMembershipBatch(options, request, operation),
      previewImportMembers: (request, operation) => previewImport(options, request, operation),
      previewAddReference: (request, operation) => previewAddReference(options, request, operation),
      previewRemoveReference: (request, operation) =>
        previewRemoveReference(options, request, operation),
      previewSetLink: (request, operation) => previewLinkChange(options, request, operation),
      previewRemoval: (request, operation) => previewCollectionRemoval(options, request, operation),
    },
    use: {
      set: (request, operation) => setUse(options, request, operation),
      add: (request, operation) => addUse(options, request, operation),
      remove: (request, operation) => removeUse(options, request, operation),
      previewSet: (request, operation) => previewCollectionUse(options, request, operation),
    },
    sources: {
      ...createSources(options),
      register: (request, operation) => registerSource(options, request, operation),
    },
    configSources: {
      ...createConfigSources(options),
      register: (request, operation) => registerConfigSource(options, request, operation),
    },
    installed: {
      ...createInstalled(options),
      ...createUpdates(options),
      ...createInstalledContent(),
    },
    gc,
    setManagedOpenCode: (request, operation) => setManagedOpenCode(options, request, operation),
    catalog: createCatalog(options),
    content: createContent(options),
  };
}
