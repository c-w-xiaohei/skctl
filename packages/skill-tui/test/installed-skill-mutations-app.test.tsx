import { expect, test } from "bun:test";
import { TextBufferRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { SkillCliError } from "@skill-cli/core";
import type {
  WorkspaceView,
  OperationResult,
  RebindImpact,
  UninstallImpact,
} from "@skill-cli/core";
import { App } from "../src/app";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
} from "./reader-test-controls";
const address = { source: "team-main", path: "guide" };
const membershipOwner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/collections/engineering/members/guide",
};
const secondMembershipOwner = {
  level: "global" as const,
  file: "/home/user/.config/skill-cli.jsonc",
  pointer: "/collections/documentation/members/guide-copy",
};
function projection(): WorkspaceView {
  const source = {
    id: "team-main",
    kind: "github" as const,
    origin: "https://github.com/acme/main",
    root: "skills",
    ref: "main",
    provenance: { level: "project" as const },
    selectors: [],
  };
  const replacement = {
    id: "replacement",
    kind: "github" as const,
    origin: "https://github.com/acme/replacement",
    root: "skills",
    ref: "main",
    provenance: { level: "project" as const },
    selectors: [],
  };
  return {
    project: { root: "/workspace/skill-cli", resolution: "explicit" },
    configs: [
      {
        level: "project",
        file: { status: "valid", file: membershipOwner.file },
        direct: {
          sources: [
            { ...source, ref: { id: source.id, owner: membershipOwner } },
            { ...replacement, ref: { id: replacement.id, owner: membershipOwner } },
          ],
          configSources: [],
          collections: [{ id: "engineering", owner: membershipOwner }],
          collectionUse: [],
          integrations: [],
        },
        contributed: { sources: [], collections: [] },
      },
    ],
    effective: {
      status: "complete",
      sources: [source, replacement],
      collections: ["engineering"],
      use: [],
      managed: false,
      collectionsView: [
        {
          id: "engineering",
          declared: [membershipOwner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
      agent: { status: "unavailable", integration: [], use: [], reasons: [], catalog: [] },
    },
    installedSkills: [
      {
        address,
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy", relevantRemoteRevision: "abcdef" },
        source,
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" },
        aliases: [],
        problems: [],
      },
    ],
    diagnostics: [],
  };
}
const result = <T,>(value: T): OperationResult<T> => ({ value, diagnostics: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function textIn(renderable: { getChildren(): readonly unknown[] }): string {
  return (
    renderable.getChildren() as {
      getChildren?: () => readonly unknown[];
      plainText?: string;
    }[]
  )
    .flatMap((child) =>
      child instanceof TextBufferRenderable
        ? [child.plainText]
        : child.getChildren
          ? [
              textIn(
                child as {
                  getChildren(): readonly unknown[];
                },
              ),
            ]
          : [],
    )
    .join("\n");
}
async function openDetailsActions(setup: Awaited<ReturnType<typeof testRender>>) {
  await openAllInstalledSkills(setup);
  await openReaderFromInspector(setup);
  await openReaderTab(setup, 2);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
  await focusLive(setup, "reader-details");
}
async function chooseAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  id: "skill-uninstall" | "skill-rebind",
) {
  if (!setup.renderer.root.findDescendantById(`reader-details-action-${id}`))
    await enterLive(setup, "reader-details-manage");
  await enterLive(setup, `reader-details-action-${id}`);
}
async function parsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", listener);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressKey("ESCAPE");
  });
  await setup.renderOnce();
}
test.each([[120, 40, "Tab controls · Esc close"]] as const)(
  "App gives the executing review overlay Esc cancel at %ix%i",
  async (width, height, expectedHelp) => {
    const executing = deferred<OperationResult<void>>();
    let executions = 0;
    let aborted = 0;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection(), {
            previewUninstall: async (
              _environment: import("@skill-cli/core").CoreOptions,
              request,
            ) =>
              result<UninstallImpact>({
                kind: "uninstall",
                installed: request.paths.map((path) => ({ source: request.source, path })),
                directMemberships: [],
                disappearingSelectors: [],
                retainedSelectors: [],
                blockers: [],
                allowed: true,
              }),
            uninstallSkills: (
              _environment: import("@skill-cli/core").CoreOptions,
              _request,
              options,
            ) => {
              executions++;
              options?.signal?.addEventListener("abort", () => {
                aborted++;
                executing.reject(new SkillCliError("CANCELLED", "cancelled"));
              });
              return executing.promise;
            },
          })}
          exit={() => {}}
        />
      ),
      { width, height },
    );
    try {
      await openDetailsActions(setup);
      await chooseAction(setup, "skill-uninstall");
      await setup.waitFor(() => setup.captureCharFrame().includes("Uninstall Skill"));
      await enterLive(setup, "installed-skill-review-confirm");
      await setup.renderOnce();
      await parsedEnter(setup);
      await setup.renderOnce();
      expect(executions).toBe(1);
      expect(aborted).toBe(0);
      expect(setup.captureCharFrame()).toContain("Uninstall Skill");
      expect(textIn(setup.renderer.root)).toContain(expectedHelp);
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.root.findDescendantById("installed-skill-review-cancel") === undefined,
      );
      expect(aborted).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  },
);
test("App returns an Installed Skill execution failure to its live review and can retry", async () => {
  let executions = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          previewUninstall: async (_environment: import("@skill-cli/core").CoreOptions, request) =>
            result<UninstallImpact>({
              kind: "uninstall",
              installed: request.paths.map((path) => ({ source: request.source, path })),
              directMemberships: [],
              disappearingSelectors: [],
              retainedSelectors: [],
              blockers: [],
              allowed: true,
            }),
          uninstallSkills: async () => {
            executions++;
            if (executions === 1) throw new Error("disk full");
            return result(undefined);
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup);
    await chooseAction(setup, "skill-uninstall");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review-cancel",
    );
    await enterLive(setup, "installed-skill-review-confirm");
    await setup.waitForFrame((frame) => frame.includes("INTERNAL: disk full"));
    expect(setup.captureCharFrame()).toContain("Uninstall Skill");
    expect(textIn(setup.renderer.root)).toContain("Tab controls · Esc close");
    await enterLive(setup, "installed-skill-review-confirm");
    await setup.waitFor(() => executions === 2);
  } finally {
    setup.renderer.destroy();
  }
});
test("App mounts operation-specific preview surfaces and suppresses stale success after cancellation", async () => {
  const pending = deferred<OperationResult<UninstallImpact>>();
  let previews = 0;
  let aborted = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          previewUninstall: (
            _environment: import("@skill-cli/core").CoreOptions,
            request,
            options,
          ) => {
            previews++;
            options?.signal?.addEventListener("abort", () => aborted++);
            if (previews === 1) return pending.promise;
            return Promise.reject(new Error("offline"));
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup);
    await chooseAction(setup, "skill-uninstall");
    await setup.waitForFrame((frame) => frame.includes("Uninstall Skill preview"));
    expect(setup.captureCharFrame()).toContain("Installed Skill: team-main/guide");
    expect(setup.captureCharFrame()).not.toContain("Reviewing Source removal impact");
    await parsedEscape(setup);
    expect(aborted).toBe(1);
    expect(setup.captureCharFrame()).toContain("Cancelling preview");
    pending.resolve(
      result({
        kind: "uninstall",
        installed: [address],
        directMemberships: [],
        disappearingSelectors: [],
        retainedSelectors: [],
        blockers: [],
        allowed: true,
      }),
    );
    await setup.waitForFrame((frame) => !frame.includes("Cancelling preview"));
    expect(setup.captureCharFrame()).not.toContain("Reviewing Source removal impact");
  } finally {
    setup.renderer.destroy();
  }
});
test("App retries an operation-specific Installed Skill preview failure", async () => {
  const retry = deferred<OperationResult<UninstallImpact>>();
  let previews = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          previewUninstall: () => {
            previews++;
            return previews === 1 ? Promise.reject(new Error("offline")) : retry.promise;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup);
    await chooseAction(setup, "skill-uninstall");
    await setup.waitForFrame((frame) => frame.includes("Uninstall Skill preview failed"));
    expect(textIn(setup.renderer.root)).toContain("Tab controls · Esc close");
    await enterLive(setup, "installed-skill-preview-failure-retry");
    await setup.waitForFrame((frame) => frame.includes("Uninstall Skill preview"));
    retry.resolve(
      result({
        kind: "uninstall",
        installed: [address],
        directMemberships: [],
        disappearingSelectors: [],
        retainedSelectors: [],
        blockers: [],
        allowed: true,
      }),
    );
    await setup.waitForFrame((frame) => frame.includes("Uninstall Skill"));
    expect(textIn(setup.renderer.root)).toContain("Tab controls · Esc close");
  } finally {
    setup.renderer.destroy();
  }
});
test("App Rebind form uses native Tab order and submits only a valid structural request", async () => {
  const requests: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          previewRebind: async (_environment: import("@skill-cli/core").CoreOptions, request) => {
            requests.push(request);
            return result<RebindImpact>({
              kind: "rebind",
              address,
              owner: request.owner,
              ownerPath: request.ownerPath ?? request.path,
              proof: "proven",
              allowed: true,
            });
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup);
    await chooseAction(setup, "skill-rebind");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "rebind-source-choice",
    );
    await parsedEnter(setup);
    await setup.renderOnce();
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("rebind-owner-path");
    await setup.mockInput.pressKeys(["/", "b", "a", "d"]);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("rebind-cancel");
    await setup.renderOnce();
    expect(requests).toEqual([]);
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    await setup.mockInput.pressKeys(["BACKSPACE", "BACKSPACE", "BACKSPACE", "BACKSPACE"]);
    await setup.mockInput.pressKeys(["a", "l", "t", "/", "g", "u", "i", "d", "e"]);
    setup.mockInput.pressKey("TAB");
    await parsedEnter(setup);
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Rebind Skill"));
    expect(requests).toEqual([
      { source: "team-main", path: "guide", owner: "replacement", ownerPath: "alt/guide" },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
test("App routes blocked Uninstall reference resolution by Collection ID with exact owner handoff", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          previewUninstall: async () =>
            result<UninstallImpact>({
              kind: "uninstall",
              installed: [address],
              directMemberships: [membershipOwner],
              disappearingSelectors: [
                {
                  selector: "engineering:guide",
                  address,
                  paths: [
                    {
                      kind: "direct",
                      collection: "engineering",
                      entryName: "guide",
                      owner: membershipOwner,
                    },
                  ],
                },
              ],
              retainedSelectors: [],
              blockers: [{ reason: "membership", owner: membershipOwner }],
              allowed: false,
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup);
    await chooseAction(setup, "skill-uninstall");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review-cancel",
    );
    await enterLive(setup, "installed-skill-review-resolve-0");
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-collection-browser",
    );
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Uninstall Membership handoff");
    expect(frame).toContain("team-main/guide");
    expect(frame).toContain("/workspace/skill-cli/skill-cli.jsonc");
    expect(textIn(setup.renderer.root)).toContain("/collections/engineering/members/guide");
    expect(frame).toContain("engineering/members/guide");
    expect(frame).toContain("engineering");
    await parsedEscape(setup);
  } finally {
    setup.renderer.destroy();
  }
});
test("App routes the selected blocked Uninstall owner to its exact selector Membership", async () => {
  const base = projection();
  const effective = base.effective;
  if (effective.status !== "complete") throw new Error("Missing effective Collections");
  const twoOwnerProjection: WorkspaceView = {
    ...base,
    configs: [
      ...base.configs,
      {
        ...base.configs[0]!,
        level: "global",
        file: { status: "valid", file: secondMembershipOwner.file },
        direct: {
          ...base.configs[0]!.direct,
          collections: [{ id: "documentation", owner: secondMembershipOwner }],
        },
      },
    ],
    effective: {
      ...effective,
      collections: ["engineering", "documentation"],
      collectionsView: [
        ...effective.collectionsView,
        {
          id: "documentation",
          declared: [secondMembershipOwner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(twoOwnerProjection, {
          previewUninstall: async () =>
            result<UninstallImpact>({
              kind: "uninstall",
              installed: [address],
              directMemberships: [membershipOwner, secondMembershipOwner],
              disappearingSelectors: [
                {
                  selector: "engineering:guide",
                  address,
                  paths: [
                    {
                      kind: "direct",
                      collection: "engineering",
                      entryName: "guide",
                      owner: membershipOwner,
                    },
                  ],
                },
                {
                  selector: "documentation:guide-copy",
                  address,
                  paths: [
                    {
                      kind: "direct",
                      collection: "documentation",
                      entryName: "guide-copy",
                      owner: secondMembershipOwner,
                    },
                  ],
                },
              ],
              retainedSelectors: [],
              blockers: [
                { reason: "membership", owner: membershipOwner },
                { reason: "membership", owner: secondMembershipOwner },
              ],
              allowed: false,
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup);
    await chooseAction(setup, "skill-uninstall");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review-cancel",
    );
    await enterLive(setup, "installed-skill-review-resolve-1");
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-collection-browser",
    );
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Uninstall Membership handoff");
    expect(frame).toContain("team-main/guide");
    expect(frame).toContain("documentation");
    expect(frame).toContain("guide-copy");
    expect(frame).toContain("/home/user/.config/skill-cli.jsonc");
    expect(textIn(setup.renderer.root)).toContain("/collections/documentation/members/guide-copy");
    expect(frame).toContain("documentation/members/guide-copy");
    expect(frame).not.toContain("Collection  engineering");
  } finally {
    setup.renderer.destroy();
  }
});
