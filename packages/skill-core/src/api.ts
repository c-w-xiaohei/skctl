import type { CatalogCapability } from "./catalog/types";
import type { CollectionsCapability, UseCapability } from "./collection/types";
import type {
  ConfigWriteResult,
  ConfigSourcesCapability,
  ManagedOpenCodeRequest,
} from "./config/types";
import type { ContentCapability } from "./content/types";
import type { InstalledCapability } from "./installed/types";
import type { OperationOptions, OperationResult, Operation } from "./shared";
import type { SourcesCapability } from "./source/types";
import type { WorkspaceCapability } from "./workspace/types";

export interface SkillCliCore {
  readonly workspace: WorkspaceCapability;
  readonly collections: CollectionsCapability;
  readonly use: UseCapability;
  readonly sources: SourcesCapability;
  readonly configSources: ConfigSourcesCapability;
  readonly installed: InstalledCapability;
  gc(options?: OperationOptions): Promise<OperationResult<void>>;
  setManagedOpenCode: Operation<ManagedOpenCodeRequest, ConfigWriteResult>;
  readonly catalog: CatalogCapability;
  readonly content: ContentCapability;
}
