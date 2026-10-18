import {
  SkillCliError,
  type AddMemberRequest,
  type AddToCollectionImpact,
  type AddReferenceRequest,
  type CollectionRequest,
  type ConfigDeclarationOwner,
  type ConfigLevel,
  type ImportMembersRequest,
  type ImportImpact,
  type LinkChangeImpact,
  type MembershipBatchImpact,
  type MembershipRemovalImpact,
  type CollectionRemovalImpact,
  type CollectionUseImpact,
  type ReferenceImpact,
  type MemberEditRequest,
  type RemoveMemberRequest,
  type RemoveReferenceRequest,
  type SetLinkRequest,
  type SetUseRequest,
} from "@skill-cli/core";

export type CollectionPreviewIntent =
  | ({ readonly kind: "add-to-collection" } & AddMemberRequest)
  | ({
      readonly kind: "membership-removal";
      readonly expectedAddress: { readonly source: string; readonly path: string };
    } & Omit<RemoveMemberRequest, "level" | "expectedAddress"> & { readonly level?: ConfigLevel })
  | ({ readonly kind: "membership-batch" } & MemberEditRequest)
  | ({ readonly kind: "collection-import" } & ImportMembersRequest)
  | ({ readonly kind: "reference-add" } & AddReferenceRequest)
  | ({ readonly kind: "reference-remove" } & RemoveReferenceRequest)
  | ({ readonly kind: "link-change" } & SetLinkRequest)
  | ({ readonly kind: "collection-use" } & SetUseRequest)
  | ({ readonly kind: "collection-removal" } & CollectionRequest);

export type CollectionIntent =
  | CollectionPreviewIntent
  | {
      readonly kind: "collection-create";
      readonly level: ConfigLevel;
      readonly collection: string;
    };
export type AddMembershipPreviewRequest = Extract<
  CollectionPreviewIntent,
  { readonly kind: "add-to-collection" }
>;

interface CollectionReviewMap {
  "add-to-collection": AddToCollectionImpact;
  "membership-removal": MembershipRemovalImpact;
  "membership-batch": MembershipBatchImpact;
  "collection-import": ImportImpact;
  "reference-add": ReferenceImpact;
  "reference-remove": ReferenceImpact;
  "link-change": LinkChangeImpact;
  "collection-use": CollectionUseImpact;
  "collection-removal": CollectionRemovalImpact;
}
export type CollectionReview = {
  [K in keyof CollectionReviewMap]: {
    readonly kind: K;
    readonly id: string;
    readonly intent: Extract<CollectionPreviewIntent, { readonly kind: K }>;
    readonly impact: CollectionReviewMap[K];
  };
}[keyof CollectionReviewMap];

function matches(condition: unknown): asserts condition {
  if (!condition)
    throw new SkillCliError(
      "TRANSACTION_CONFLICT",
      "Collection preview no longer matches the selected structural intent",
    );
}
const sameOwner = (left: ConfigDeclarationOwner, right: ConfigDeclarationOwner) =>
  left.level === right.level && left.file === right.file && left.pointer === right.pointer;
const sameAddress = (
  left: { source: string; path: string },
  right: { source: string; path: string },
) => left.source === right.source && left.path === right.path;

type CollectionPreviewCore = {
  readonly collections: Pick<
    import("./effects").TuiCore["collections"],
    | "previewAddMember"
    | "previewRemoveMember"
    | "previewMemberEdit"
    | "previewImportMembers"
    | "previewAddReference"
    | "previewRemoveReference"
    | "previewSetLink"
    | "previewRemoval"
  >;
  readonly use: Pick<import("./effects").TuiCore["use"], "previewSet">;
};
export async function previewCollection(
  core: CollectionPreviewCore,
  intent: CollectionPreviewIntent,
  id: string,
  signal: AbortSignal,
): Promise<CollectionReview> {
  switch (intent.kind) {
    case "add-to-collection": {
      const impact = (
        await core.collections.previewAddMember(
          {
            level: intent.level,
            collection: intent.collection,
            name: intent.name,
            address: intent.address,
          },
          { signal },
        )
      ).value;
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
      return { kind: intent.kind, id, intent, impact };
    }
    case "membership-removal": {
      const impact = (
        await core.collections.previewRemoveMember(
          {
            collection: intent.collection,
            name: intent.name,
            expectedAddress: intent.expectedAddress,
            ...(intent.level ? { level: intent.level } : {}),
            ...(intent.expectedOwner ? { expectedOwner: intent.expectedOwner } : {}),
          },
          { signal },
        )
      ).value;
      matches(
        impact.kind === "membership-removal" &&
          impact.collection === intent.collection &&
          impact.name === intent.name &&
          impact.affected.some((affected) => sameAddress(affected.address, intent.expectedAddress)),
      );
      return { kind: intent.kind, id, intent, impact };
    }
    case "membership-batch": {
      const impact = (
        await core.collections.previewMemberEdit(
          {
            level: intent.level,
            collection: intent.collection,
            additions: intent.additions,
            removals: intent.removals,
            ...(intent.expectedOwner ? { expectedOwner: intent.expectedOwner } : {}),
          },
          { signal },
        )
      ).value;
      matches(
        impact.kind === "membership-batch" &&
          impact.collection === intent.collection &&
          impact.decision.kind === "direct" &&
          impact.decision.owner.level === intent.level &&
          (!intent.expectedOwner || sameOwner(impact.decision.owner, intent.expectedOwner)),
      );
      return { kind: intent.kind, id, intent, impact };
    }
    case "collection-import": {
      const impact = (
        await core.collections.previewImportMembers(
          { level: intent.level, from: intent.from, into: intent.into },
          { signal },
        )
      ).value;
      matches(
        impact.kind === "collection-import" &&
          impact.source === intent.from &&
          impact.destination === intent.into &&
          impact.owner?.level === intent.level,
      );
      return { kind: intent.kind, id, intent, impact };
    }
    case "reference-add": {
      const { kind: _kind, ...request } = intent;
      const impact = (await core.collections.previewAddReference(request, { signal })).value;
      matches(
        impact.kind === "reference" &&
          impact.collection === intent.collection &&
          impact.name === intent.name &&
          impact.referencedCollection === intent.target &&
          impact.description === intent.description &&
          impact.owner?.level === intent.level &&
          (!intent.expectedOwner || sameOwner(impact.owner, intent.expectedOwner)),
      );
      return { kind: intent.kind, id, intent, impact };
    }
    case "reference-remove": {
      const { kind: _kind, ...request } = intent;
      const impact = (await core.collections.previewRemoveReference(request, { signal })).value;
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
      return { kind: intent.kind, id, intent, impact };
    }
    case "link-change": {
      const { kind: _kind, ...request } = intent;
      const impact = (await core.collections.previewSetLink(request, { signal })).value;
      matches(
        impact.kind === "link-change" &&
          impact.collection === intent.collection &&
          impact.target === intent.target &&
          impact.linked === intent.linked &&
          impact.owner?.level === intent.level &&
          (!intent.expectedOwner || sameOwner(impact.owner, intent.expectedOwner)),
      );
      return { kind: intent.kind, id, intent, impact };
    }
    case "collection-use": {
      const impact = (
        await core.use.previewSet(
          { level: intent.level, collections: intent.collections },
          { signal },
        )
      ).value;
      matches(
        impact.kind === "collection-use" &&
          impact.owner.level === intent.level &&
          impact.newCollections.length === intent.collections.length &&
          impact.newCollections.every(
            (value: string, index: number) => value === intent.collections[index],
          ),
      );
      return { kind: intent.kind, id, intent, impact };
    }
    case "collection-removal": {
      const impact = (await core.collections.previewRemoval(intent, { signal })).value;
      matches(
        impact.kind === "collection-removal" &&
          impact.owner?.level === intent.level &&
          impact.decision?.kind === "direct" &&
          impact.decision.owner.level === intent.level,
      );
      return { kind: intent.kind, id, intent, impact };
    }
  }
}
