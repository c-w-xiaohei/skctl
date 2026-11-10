/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { ConfigDeclarationOwner, MembershipBatchImpact } from "@skctl/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { enterLive } from "./reader-test-controls";
import { openMainPage } from "./main-page-controls";
for (const fault of [
  "level",
  "file",
  "namespace",
  "pointer",
  "contributed",
  "missing",
  "receipt-level",
  "receipt-file",
  "receipt-pointer",
  "receipt-name",
  "receipt-address",
] as const) {
  test(`Membership ${fault} mismatch cannot open an executable review or write`, async () => {
    const projection = collectionsSourcesProjection();
    if (projection.effective.status !== "complete") throw new Error("Expected complete fixture");
    const collection = projection.effective.collectionsView.find((item) => item.id === "team")!;
    const member = collection.members.find((item) => item.name === "guide")!;
    const path = member.paths.find((candidate) => candidate.kind === "direct")!;
    if (path.kind !== "direct" || !path.owner) throw new Error("Expected direct origin");
    const owner: ConfigDeclarationOwner = {
      ...path.owner,
      ...(fault === "level" ? { level: "local" } : {}),
      ...(fault === "file" ? { file: "/different/config.jsonc" } : {}),
      ...(fault === "namespace" ? { namespace: "different" } : {}),
      ...(fault === "pointer" ? { pointer: "/collections/team/members/sibling" } : {}),
      ...(fault === "contributed"
        ? {
            contribution: {
              configSource: collection.declared[0]!,
              declaration: {
                level: "project",
                file: "/snapshot/config.jsonc",
                pointer: path.owner.pointer,
              },
            },
          }
        : {}),
    };
    const origin = fault === "missing" ? { ...path, owner: undefined } : { ...path, owner };
    const core = directSourceCore({
      ...projection,
      effective: {
        ...projection.effective,
        collections: ["team"],
        collectionsView: [{ ...collection, members: [{ ...member, paths: [origin] }] }],
      },
    });
    const requests: unknown[] = [];
    let writes = 0;
    core.editMembers = async () => {
      writes++;
      throw new Error("Guard must not write");
    };
    core.previewMembershipBatch = async (
      _environment: import("@skctl/core").CoreOptions,
      request,
    ) => {
      requests.push(request);
      const declaration = collection.declared[0]!;
      const receipt: MembershipBatchImpact = {
        kind: "membership-batch",
        collection: request.collection,
        decision: {
          kind: "direct",
          owner: {
            ...declaration,
            ...(fault === "receipt-level" ? { level: "local" } : {}),
            ...(fault === "receipt-file" ? { file: "/different/config.jsonc" } : {}),
            ...(fault === "receipt-pointer" ? { pointer: "/collections/other" } : {}),
          },
        },
        additions: request.additions,
        removals: request.removals.map((item) => ({
          ...item,
          ...(fault === "receipt-name" ? { name: "different" } : {}),
          ...(fault === "receipt-address"
            ? { expectedAddress: { ...item.expectedAddress, path: "different" } }
            : {}),
        })),
        affected: [],
        blockers: [],
        effectful: true,
        allowed: true,
      };
      return { value: receipt, diagnostics: [] };
    };
    const setup = await testRender(() => <App core={core} exit={() => {}} />, {
      width: 144,
      height: 40,
    });
    try {
      await setup.flush();
      await openMainPage(setup, "collections");
      await enterLive(setup, "collection-browser");
      await enterLive(setup, "collection-more");
      await setup.flush();
      const remove = setup.renderer.root.findDescendantById("collection-current-membership.remove");
      if (fault === "missing" || fault === "contributed") {
        expect(!!remove).toBe(false);
      } else await enterLive(setup, "collection-current-membership.remove");
      await setup.flush();
      expect(requests).toHaveLength(fault.startsWith("receipt-") ? 1 : 0);
      expect(!!setup.renderer.root.findDescendantById("collection-review-confirm")).toBe(false);
      expect(writes).toBe(0);
    } catch (error) {
      console.error(setup.captureCharFrame());
      throw error;
    } finally {
      setup.renderer.destroy();
    }
  });
}
