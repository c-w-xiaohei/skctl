import * as api from "@skctl/core";
import {
  SkctlError,
  type AddMemberRequest,
  type AddReferenceRequest,
  type CollectionRequest,
  type ConfigDeclarationOwner,
  type ConfigLevel,
  type ImportMembersRequest,
  type MemberEditRequest,
  type RemoveMemberRequest,
  type RemoveReferenceRequest,
  type SetLinkRequest,
  type SetUseRequest,
} from "@skctl/core";
export type CollectionPreviewIntent =
  | ({
      readonly kind: "add-to-collection";
    } & AddMemberRequest)
  | ({
      readonly kind: "membership-removal";
      readonly expectedAddress: {
        readonly source: string;
        readonly path: string;
      };
    } & Omit<RemoveMemberRequest, "level" | "expectedAddress"> & {
        readonly level?: ConfigLevel;
      })
  | ({
      readonly kind: "membership-batch";
    } & MemberEditRequest)
  | ({
      readonly kind: "collection-import";
    } & ImportMembersRequest)
  | ({
      readonly kind: "reference-add";
    } & AddReferenceRequest)
  | ({
      readonly kind: "reference-remove";
    } & RemoveReferenceRequest)
  | ({
      readonly kind: "link-change";
    } & SetLinkRequest)
  | ({
      readonly kind: "collection-use";
    } & SetUseRequest)
  | ({
      readonly kind: "collection-removal";
    } & CollectionRequest);
export type CollectionIntent =
  | CollectionPreviewIntent
  | {
      readonly kind: "collection-create";
      readonly level: ConfigLevel;
      readonly collection: string;
    };
export type AddMembershipPreviewRequest = Extract<
  CollectionPreviewIntent,
  {
    readonly kind: "add-to-collection";
  }
>;
export type CollectionReview = Awaited<ReturnType<typeof previewCollection>>;
function matches(condition: unknown): asserts condition {
  if (!condition)
    throw new SkctlError(
      "TRANSACTION_CONFLICT",
      "Collection preview no longer matches the selected structural intent",
    );
}
const sameOwner = (left: ConfigDeclarationOwner, right: ConfigDeclarationOwner) =>
  left.level === right.level && left.file === right.file && left.pointer === right.pointer;
const sameAddress = (
  left: {
    source: string;
    path: string;
  },
  right: {
    source: string;
    path: string;
  },
) => left.source === right.source && left.path === right.path;
type CollectionPreviewCore = Pick<
  typeof api,
  | "previewAddToCollection"
  | "previewMembershipRemoval"
  | "previewMembershipBatch"
  | "previewImport"
  | "previewAddReference"
  | "previewRemoveReference"
  | "previewLinkChange"
  | "previewCollectionRemoval"
  | "previewCollectionUse"
>;
export async function previewCollection(
  core: CollectionPreviewCore,
  intent: CollectionPreviewIntent,
  id: string,
  signal: AbortSignal,
  environment: api.CoreOptions = { cwd: process.cwd() },
) {
  switch (intent.kind) {
    case "add-to-collection": {
      const { kind: _, ...request } = intent;
      const impact = (await core.previewAddToCollection(environment, request, { signal })).value;
      matches(
        impact.kind === "add-to-collection" &&
          impact.collection === intent.collection &&
          sameAddress(impact.address, intent.address),
      );
      if (impact.decision.kind === "direct") {
        matches(
          impact.intent?.owner.level === intent.level &&
            sameAddress(impact.intent.address, intent.address) &&
            impact.intent.stableEntryName === intent.name,
        );
      } else
        matches(
          impact.decision.kind === "repository-derived" &&
            impact.createDirectContribution?.collection === intent.collection,
        );
      return { kind: intent.kind, id, intent, impact } as const;
    }
    case "membership-removal": {
      const { kind: _, ...request } = intent;
      const impact = (await core.previewMembershipRemoval(environment, request, { signal })).value;
      matches(
        impact.kind === "membership-removal" &&
          impact.collection === intent.collection &&
          impact.name === intent.name &&
          impact.affected.some((affected) => sameAddress(affected.address, intent.expectedAddress)),
      );
      return { kind: intent.kind, id, intent, impact } as const;
    }
    case "membership-batch": {
      const { kind: _, ...request } = intent;
      const impact = (await core.previewMembershipBatch(environment, request, { signal })).value;
      matches(
        impact.kind === "membership-batch" &&
          impact.collection === intent.collection &&
          impact.decision.kind === "direct" &&
          impact.decision.owner.level === intent.level &&
          (!intent.expectedOwner || sameOwner(impact.decision.owner, intent.expectedOwner)),
      );
      return { kind: intent.kind, id, intent, impact } as const;
    }
    case "collection-import": {
      const { kind: _, ...request } = intent;
      const impact = (await core.previewImport(environment, request, { signal })).value;
      matches(
        impact.kind === "collection-import" &&
          impact.source === intent.from &&
          impact.destination === intent.into &&
          impact.owner?.level === intent.level,
      );
      return { kind: intent.kind, id, intent, impact } as const;
    }
    case "reference-add": {
      const { kind: _kind, ...request } = intent;
      const impact = (await core.previewAddReference(environment, request, { signal })).value;
      matches(
        impact.kind === "reference" &&
          impact.collection === intent.collection &&
          impact.name === intent.name &&
          impact.referencedCollection === intent.target &&
          impact.description === intent.description &&
          impact.owner?.level === intent.level &&
          (!intent.expectedOwner || sameOwner(impact.owner, intent.expectedOwner)),
      );
      return { kind: intent.kind, id, intent, impact } as const;
    }
    case "reference-remove": {
      const { kind: _kind, ...request } = intent;
      const impact = (await core.previewRemoveReference(environment, request, { signal })).value;
      matches(
        impact.kind === "reference" &&
          impact.collection === intent.collection &&
          impact.name === intent.name &&
          impact.referencedCollection ===
            (intent.expected?.collection ?? impact.referencedCollection) &&
          impact.description === (intent.expected?.description ?? impact.description) &&
          impact.owner?.level === intent.level &&
          (!intent.expectedOwner || sameOwner(impact.owner, intent.expectedOwner)),
      );
      return { kind: intent.kind, id, intent, impact } as const;
    }
    case "link-change": {
      const { kind: _kind, ...request } = intent;
      const impact = (await core.previewLinkChange(environment, request, { signal })).value;
      matches(
        impact.kind === "link-change" &&
          impact.collection === intent.collection &&
          impact.target === intent.target &&
          impact.linked === intent.linked &&
          impact.owner?.level === intent.level &&
          (!intent.expectedOwner || sameOwner(impact.owner, intent.expectedOwner)),
      );
      return { kind: intent.kind, id, intent, impact } as const;
    }
    case "collection-use": {
      const { kind: _, ...request } = intent;
      const impact = (await core.previewCollectionUse(environment, request, { signal })).value;
      matches(
        impact.kind === "collection-use" &&
          impact.owner.level === intent.level &&
          impact.newCollections.length === intent.collections.length &&
          impact.newCollections.every(
            (value: string, index: number) => value === intent.collections[index],
          ),
      );
      return { kind: intent.kind, id, intent, impact } as const;
    }
    case "collection-removal": {
      const impact = (await core.previewCollectionRemoval(environment, intent, { signal })).value;
      matches(
        impact.kind === "collection-removal" &&
          impact.owner?.level === intent.level &&
          impact.decision?.kind === "direct" &&
          impact.decision.owner.level === intent.level,
      );
      return { kind: intent.kind, id, intent, impact } as const;
    }
  }
}
