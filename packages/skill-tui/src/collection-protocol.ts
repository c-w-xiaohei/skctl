import {
  SkillCliError,
  type ConfigurationCapability,
  type ConfigChange,
  type ConfigDeclarationOwner,
  type ConfigLevel,
} from "@skill-cli/core";

type Preview<M extends keyof ConfigurationCapability> = {
  readonly request: Parameters<ConfigurationCapability[M]>[0] & { readonly level: ConfigLevel };
  readonly impact: Awaited<ReturnType<ConfigurationCapability[M]>>["value"];
};
type CollectionProtocol = {
  "add-to-collection": {
    readonly request: Omit<Preview<"previewAddToCollection">["request"], "name"> & {
      readonly name?: string;
    };
    readonly impact: Preview<"previewAddToCollection">["impact"];
  };
  "membership-removal": Preview<"previewMembershipRemoval"> & {
    readonly request: {
      readonly expectedAddress: { readonly source: string; readonly path: string };
      readonly expectedOwner?: ConfigDeclarationOwner;
    };
  };
  "membership-batch": Preview<"previewMembershipBatch"> & {
    readonly request: { readonly expectedOwner?: ConfigDeclarationOwner };
  };
  "collection-import": Preview<"previewImport">;
  reference: Preview<"previewReference">;
  "link-change": Preview<"previewLinkChange">;
  "collection-use": Preview<"previewCollectionUse">;
  "collection-removal": Preview<"previewCollectionRemoval">;
};
export type CollectionPreviewIntent = {
  [K in keyof CollectionProtocol]: CollectionProtocol[K]["request"] & { readonly kind: K };
}[keyof CollectionProtocol];
export type CollectionIntent =
  | CollectionPreviewIntent
  | {
      readonly kind: "collection-create";
      readonly level: ConfigLevel;
      readonly collection: string;
    };
export type AddMembershipPreviewRequest = Extract<
  CollectionIntent,
  { readonly kind: "add-to-collection" }
>;
export type CollectionReview = {
  [K in keyof CollectionProtocol]: {
    readonly kind: K;
    readonly id: string;
    readonly intent: CollectionProtocol[K]["request"] & { readonly kind: K };
    readonly impact: CollectionProtocol[K]["impact"];
  };
}[keyof CollectionProtocol];

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

/** Bind one preview to its exact request and prepare its write once, never from UI display data.
 * This is a frontend protocol, not authority: Core still validates fresh declarations under its lock.
 */
export async function previewCollection(
  configuration: Omit<ConfigurationCapability, "change">,
  intent: CollectionPreviewIntent,
  id: string,
  signal: AbortSignal,
): Promise<{ readonly review: CollectionReview; readonly change?: ConfigChange }> {
  switch (intent.kind) {
    case "add-to-collection": {
      const { level, collection, address, name } = intent;
      const { value: impact } = await configuration.previewAddToCollection(
        { level, collection, address, name: name! },
        { signal },
      );
      matches(
        impact.kind === intent.kind &&
          impact.collection === collection &&
          sameAddress(impact.address, address),
      );
      let change: ConfigChange | undefined;
      if (impact.decision.kind === "direct") {
        matches(
          impact.intent &&
            impact.intent.owner.level === level &&
            sameOwner(impact.decision.owner, impact.intent.owner) &&
            sameAddress(impact.intent.address, address) &&
            impact.intent.stableEntryName === name,
        );
        if (!impact.intent.stableEntryName)
          throw new SkillCliError(
            "TRANSACTION_CONFLICT",
            "Collection preview did not provide an executable membership or next step",
          );
        change = {
          type: "collection.member.set",
          level: impact.intent.owner.level,
          collection,
          name: impact.intent.stableEntryName,
          address: impact.intent.address,
        };
      } else
        matches(
          impact.decision.kind === "repository-derived" &&
            impact.createDirectContribution?.collection === collection,
        );
      return { review: { kind: intent.kind, id, intent, impact }, change };
    }
    case "membership-removal": {
      const { level, collection, name, expectedOwner, expectedAddress } = intent;
      if (!expectedAddress.source || !expectedAddress.path)
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Remove Membership requires the exact expected structural address",
        );
      const { value: impact } = await configuration.previewMembershipRemoval(
        { level, collection, name, ...(expectedOwner ? { expectedOwner } : {}) },
        { signal },
      );
      matches(
        impact.kind === intent.kind &&
          impact.collection === collection &&
          impact.name === name &&
          impact.decision.kind === "direct" &&
          impact.decision.owner.level === level &&
          impact.affected.some((affected) => sameAddress(affected.address, expectedAddress)),
      );
      return {
        review: { kind: intent.kind, id, intent, impact },
        change: {
          type: "collection.member.remove",
          level: impact.decision.owner.level,
          collection,
          name,
          expectedAddress,
        },
      };
    }
    case "membership-batch": {
      const { level, collection, expectedOwner, additions, removals } = intent;
      const { value: impact } = await configuration.previewMembershipBatch(
        {
          level,
          collection,
          ...(expectedOwner && removals.length ? { expectedOwner } : {}),
          additions,
          removals,
        },
        { signal },
      );
      matches(
        impact.kind === intent.kind &&
          impact.collection === collection &&
          impact.decision.kind === "direct" &&
          impact.decision.owner.level === level &&
          (!expectedOwner || sameOwner(impact.decision.owner, expectedOwner)) &&
          JSON.stringify(impact.additions) === JSON.stringify(additions) &&
          JSON.stringify(impact.removals) === JSON.stringify(removals),
      );
      return {
        review: { kind: intent.kind, id, intent, impact },
        change: {
          type: "collection.members.change",
          level: impact.decision.owner.level,
          collection,
          additions,
          removals,
          reviewedAffected: impact.affected,
        },
      };
    }
    case "collection-import": {
      const { level, from, into } = intent;
      const { value: impact } = await configuration.previewImport(
        { level, from, into },
        { signal },
      );
      matches(
        impact.kind === intent.kind &&
          impact.source === from &&
          impact.destination === into &&
          impact.owner?.level === level,
      );
      return {
        review: { kind: intent.kind, id, intent, impact },
        change: { type: "collection.import", level, from, into },
      };
    }
    case "reference": {
      const { level, collection, name, target, description, remove } = intent;
      const { value: impact } = await configuration.previewReference(
        { level, collection, name, target, description, remove },
        { signal },
      );
      matches(
        impact.kind === intent.kind &&
          impact.collection === collection &&
          impact.name === name &&
          impact.referencedCollection === target &&
          impact.description === description &&
          impact.owner?.level === level,
      );
      const change: ConfigChange = remove
        ? {
            type: "collection.reference.remove",
            level: impact.owner.level,
            collection,
            name,
            expected: { collection: target, description },
          }
        : {
            type: "collection.reference.set",
            level: impact.owner.level,
            collection,
            name,
            target,
            description,
          };
      return { review: { kind: intent.kind, id, intent, impact }, change };
    }
    case "link-change": {
      const { level, collection, target, linked } = intent;
      const { value: impact } = await configuration.previewLinkChange(
        { level, collection, target, linked },
        { signal },
      );
      matches(
        impact.kind === intent.kind &&
          impact.collection === collection &&
          impact.target === target &&
          impact.linked === linked &&
          impact.owner?.level === level,
      );
      return {
        review: { kind: intent.kind, id, intent, impact },
        change: { type: "collection.link.set", level, collection, target, linked },
      };
    }
    case "collection-use": {
      const { level, collections } = intent;
      const { value: impact } = await configuration.previewCollectionUse(
        { level, collections },
        { signal },
      );
      matches(
        impact.kind === intent.kind &&
          impact.owner.level === level &&
          impact.newCollections.length === collections.length &&
          impact.newCollections.every((value, index) => value === collections[index]),
      );
      return {
        review: { kind: intent.kind, id, intent, impact },
        change: { type: "use.set", level, collections },
      };
    }
    case "collection-removal": {
      const { level, collection } = intent;
      const { value: impact } = await configuration.previewCollectionRemoval(
        { level, collection },
        { signal },
      );
      matches(
        impact.kind === intent.kind &&
          impact.owner?.level === level &&
          impact.decision?.kind === "direct" &&
          impact.decision.owner.level === level,
      );
      return {
        review: { kind: intent.kind, id, intent, impact },
        change: { type: "collection.remove", level, collection },
      };
    }
  }
}
