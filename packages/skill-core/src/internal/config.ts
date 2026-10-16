// Stable internal entry point; implementation modules depend on responsibilities, not this facade.
export {
  schemaId,
  schemaJson,
  userConfigSchema,
  projectConfigSchema,
  localConfigSchema,
  configModuleSchema,
  persistedConfigSchema,
  userConfigValidator,
  projectConfigValidator,
  localConfigValidator,
  configModuleValidator,
  validateConfigBytes,
  setConfigReadHookForTest,
  type ConfigDocument,
} from "./config-document";
export {
  resolveProjectRoot,
  type ReadWorkspaceOptions,
  type MutationOptions,
} from "./config-inputs";
export { contributedSourceBindings } from "./config-bindings";
export {
  capturedWorkspace,
  readUserNetwork,
  readWorkspace,
  readWorkspaceUnlocked,
  migrateLegacyInstalled,
} from "./config-workspace";
export { resolveInstalledSelector, resolveEffectiveCollections } from "./config-resolution";
export {
  declaredConfigSource,
  forgetConfigSource,
  removeConfigSource,
  configSourceDependencies,
  removeDirectSource,
  membershipBatchAffected,
  previewLinkChangeImpact,
  mutateConfiguration,
} from "./config-edit";
