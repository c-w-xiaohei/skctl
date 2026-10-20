import { SkctlError, type OperationOptions } from "../shared";
import * as v from "valibot";
import { setCollectionContentRequestSchema } from "./domain.schema";
import { type CoreOptions } from "../shared";
import type {
  AddMemberRequest,
  AddReferenceRequest,
  CollectionRequest,
  ImportMembersRequest,
  RemoveMemberRequest,
  RemoveReferenceRequest,
  ReviewedMemberEditRequest,
  SetLinkRequest,
  SetCollectionContentRequest,
} from "./types";

import { sameSkillAddress } from "./graph";
import { parseNameSegment, parseQualifiedName } from "./names";

import { assertDeclarationOwner, writeConfig, type ConfigEdit } from "../config/write";
import { changedLinks, membershipBatchAffected, sameMembershipAffected } from "./impact";
import { readWorkspaceUnlocked } from "../workspace/capture";
import { resolveEffectiveCollections } from "./resolve";
import {
  normalizeMemberEdit,
  editMembers as transformMembers,
  importMembers as importDelta,
} from "./members";

function collection(edit: ConfigEdit, request: CollectionRequest, memberName?: string) {
  parseQualifiedName(request.collection);
  const declaration = edit.collection(request.collection);
  const pointer =
    memberName !== undefined &&
    request.expectedOwner?.pointer === `/collections/${request.collection}/members/${memberName}`
      ? `/collections/${request.collection}/members/${memberName}`
      : `/collections/${request.collection}`;
  assertDeclarationOwner({ level: edit.level, file: edit.file, pointer }, request.expectedOwner);
  return declaration;
}
export function createCollection(
  options: CoreOptions,
  request: Pick<CollectionRequest, "level" | "collection">,
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    (edit) => {
      parseQualifiedName(request.collection);
      if (edit.document().collections?.[request.collection])
        throw new SkctlError("CONFIG_CONFLICT", "Collection already exists");
      edit.set(["collections", request.collection], {});
      return {};
    },
    operation,
  );
}
export function setCollectionContent(
  options: CoreOptions,
  request: SetCollectionContentRequest,
  operation?: OperationOptions,
) {
  const parsed = v.safeParse(setCollectionContentRequestSchema, request);
  if (!parsed.success) throw new SkctlError("INVALID_ARGUMENT", "Invalid Collection content");
  const content = parsed.output;
  if (content.description === undefined && content.instructions === undefined)
    throw new SkctlError("INVALID_ARGUMENT", "Specify a description or instructions change");
  return writeConfig(
    options,
    content.level,
    (edit) => {
      collection(edit, content);
      for (const field of ["description", "instructions"] as const) {
        if (content[field] !== undefined)
          edit.set(["collections", content.collection, field], content[field] ?? undefined);
      }
      return {};
    },
    operation,
  );
}

export function removeCollection(
  options: CoreOptions,
  request: CollectionRequest,
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    async (edit) => {
      const declaration = collection(edit, request);
      const { value: workspace } = await readWorkspaceUnlocked(
        edit.workspaceOptions,
        edit.coordinator,
      );
      if (workspace.effective.status !== "complete")
        throw new SkctlError("CONFIG_INVALID", "Configuration is incomplete");
      const dependent =
        (declaration.links?.length ?? 0) > 0 ||
        workspace.configs.some((config) =>
          config.direct.collectionUse.some((use) => use.collection === request.collection),
        ) ||
        workspace.effective.collectionsView.some(
          (item) =>
            item.references.some((reference) => reference.collection === request.collection) ||
            item.links.some((link) => link.collection === request.collection),
        );
      if (
        dependent ||
        !workspace.effective.collectionsView.some((item) => item.id === request.collection)
      )
        throw new SkctlError("CONFIG_CONFLICT", "Collection has declaration dependencies");
      edit.set(["collections", request.collection], undefined);
      return {};
    },
    operation,
  );
}
export function addMember(
  options: CoreOptions,
  request: AddMemberRequest,
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    (edit) => {
      parseNameSegment(request.name);
      const current = collection(edit, request).members?.[request.name];
      if (current && !sameSkillAddress(current, request.address))
        throw new SkctlError("CONFIG_CONFLICT", "Membership entry name is already in use");
      edit.set(["collections", request.collection, "members", request.name], request.address);
      return {};
    },
    operation,
  );
}
export function removeMember(
  options: CoreOptions,
  request: RemoveMemberRequest,
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    (edit) => {
      parseNameSegment(request.name);
      const member = collection(edit, request, request.name).members?.[request.name];
      if (!member)
        throw new SkctlError(
          "INVALID_ARGUMENT",
          `Membership "${request.name}" is not directly declared in Collection "${request.collection}" at ${request.level} scope in ${edit.file}`,
        );
      if (request.expectedAddress && !sameSkillAddress(member, request.expectedAddress))
        throw new SkctlError("CONFIG_CONFLICT", "Membership changed after preview");
      edit.set(["collections", request.collection, "members", request.name], undefined);
      return {};
    },
    operation,
  );
}
export async function editMembers(
  options: CoreOptions,
  request: ReviewedMemberEditRequest,
  operation?: OperationOptions,
) {
  const normalized = normalizeMemberEdit(request);
  return writeConfig(
    options,
    request.level,
    async (edit) => {
      const { members, changed } = transformMembers(
        collection(edit, request).members ?? {},
        normalized,
      );
      if (changed) edit.set(["collections", request.collection, "members"], members);
      const workspace = await readWorkspaceUnlocked(edit.workspaceOptions, edit.coordinator);
      const affected = await membershipBatchAffected(
        options,
        workspace.value,
        await edit.coordinator.read(),
        edit.coordinator,
        { file: edit.file, value: edit.proposed() },
      );
      if (!sameMembershipAffected(request.reviewedAffected, affected))
        throw new SkctlError("CONFIG_CONFLICT", "Membership impact changed after review");
      return {};
    },
    operation,
  );
}
export function importMembers(
  options: CoreOptions,
  request: ImportMembersRequest,
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    async (edit) => {
      parseQualifiedName(request.from);
      parseQualifiedName(request.into);
      const workspace = await readWorkspaceUnlocked(edit.workspaceOptions, edit.coordinator);
      const resolved = await resolveEffectiveCollections(
        options,
        workspace.value,
        await edit.coordinator.read(),
        edit.coordinator,
      );
      const source = resolved.members.get(request.from);
      if (!source)
        throw new SkctlError("REFERENCE_NOT_FOUND", `Collection not found: ${request.from}`);
      const target = edit.collection(request.into).members ?? {};
      const delta = importDelta(
        target,
        [...source].map(([name, address]) => ({ name, address })),
      );
      if (delta.conflicts.length)
        throw new SkctlError(
          "EXPOSURE_CONFLICT",
          `Collection member conflict: ${delta.conflicts[0]!.name}`,
        );
      for (const { name, address } of delta.additions)
        edit.set(["collections", request.into, "members", name], address);
      return {};
    },
    operation,
  );
}
export function addReference(
  options: CoreOptions,
  request: AddReferenceRequest,
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    (edit) => {
      parseQualifiedName(request.target);
      parseNameSegment(request.name);
      if (collection(edit, request).references?.[request.name])
        throw new SkctlError("CONFIG_CONFLICT", "Reference name already exists");
      edit.set(["collections", request.collection, "references", request.name], {
        collection: request.target,
        description: request.description,
      });
      return {};
    },
    operation,
  );
}
export function removeReference(
  options: CoreOptions,
  request: RemoveReferenceRequest,
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    (edit) => {
      parseNameSegment(request.name);
      const reference = collection(edit, request).references?.[request.name];
      if (!reference) throw new SkctlError("REFERENCE_NOT_FOUND", "Reference not found");
      if (
        request.expected &&
        (reference.collection !== request.expected.collection ||
          reference.description !== request.expected.description)
      )
        throw new SkctlError("CONFIG_CONFLICT", "Reference changed after preview");
      edit.set(["collections", request.collection, "references", request.name], undefined);
      return {};
    },
    operation,
  );
}
export function setLink(
  options: CoreOptions,
  request: SetLinkRequest,
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    (edit) => {
      const links = changedLinks(
        collection(edit, request).links ?? [],
        request.target,
        request.linked,
      );
      edit.set(["collections", request.collection, "links"], links);
      return {};
    },
    operation,
  );
}
