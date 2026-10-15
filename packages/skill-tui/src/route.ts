import { batch, createSignal, type Accessor } from "solid-js";
import type { ManagementProjection } from "@skill-cli/core";
import {
  validSections,
  type ConfigSection,
  type Destination,
  type FocusOwner,
  type NavigationContext,
  type NavigationRegion,
  type NavigationSurface,
  type ReaderState,
  type RouteHandoff,
  sameSkillAddress,
  type SkillAddress,
  type WorkspaceSection,
} from "./types";
import type { WorkspaceSnapshot, WorkspaceState } from "./workspace/state";
import type { ConfigSnapshot, ConfigState } from "./config/state";
import type { CollectionsSnapshot, CollectionsState } from "./collections/state";
import { configDeclarationOwnerKey } from "./config/state";
import type { UpdatesState } from "./updates/state";

export type RouteTarget =
  | {
      readonly destination: "workspace";
      readonly section: "skills";
      readonly selection?: SkillAddress;
      readonly handoff?: RouteHandoff;
      readonly surface?: NavigationSurface;
      readonly region?: NavigationRegion;
      readonly focus?: FocusOwner;
    }
  | {
      readonly destination: "workspace";
      readonly section: Exclude<WorkspaceSection, "skills">;
      readonly selection?: string;
      readonly handoff?: RouteHandoff;
      readonly surface?: NavigationSurface;
      readonly region?: NavigationRegion;
      readonly focus?: FocusOwner;
    }
  | {
      readonly destination: Exclude<Destination, "workspace">;
      readonly section: ConfigSection;
      readonly selection?: string;
      readonly handoff?: RouteHandoff;
      readonly surface?: NavigationSurface;
      readonly region?: NavigationRegion;
      readonly focus?: FocusOwner;
    };

export interface NavigationFrame {
  readonly context: NavigationContext;
  readonly section: RouteTarget["section"];
  readonly object?: string | SkillAddress;
  readonly surface: NavigationSurface;
  readonly region: NavigationRegion;
  readonly focus: FocusOwner;
  readonly handoff?: RouteHandoff;
  readonly workspace: WorkspaceSnapshot;
  readonly config: Readonly<Record<Exclude<Destination, "workspace">, ConfigSnapshot>>;
  readonly collections?: CollectionsSnapshot;
  readonly narrowLevel?: import("./types").NarrowLevel;
  readonly reader?: ReaderState;
  /** Effects owns this draft; routes retain only its current identity for Back. */
  readonly updatesState?: UpdatesState;
  readonly recovery?: "unavailable";
}

export interface RouteSnapshot {
  readonly current: NavigationFrame;
  readonly stack: readonly NavigationFrame[];
  /** Active context exposed alongside the complete navigation frame. */
  readonly destination: Destination;
  readonly handoff?: RouteHandoff;
  readonly revision: number;
}

export type RelationshipTarget = RouteTarget & {
  readonly returnFocus: FocusOwner;
};

const validTarget = (target: Pick<RouteTarget, "destination" | "section">) =>
  validSections(target.destination).includes(target.section);

const focusFor = (surface: NavigationSurface, fallback: FocusOwner = "browser"): FocusOwner =>
  surface === "reader" ? "reader-tabs" : surface === "inspector" ? "inspector" : fallback;

/** The only owner of active navigation state and exact return frames. */
export function createRoute(
  pages: {
    readonly workspace: WorkspaceState;
    readonly config: ConfigState;
    readonly collections?: CollectionsState;
  },
  requestFocus: (owner: FocusOwner) => void = () => {},
  dismissOverlay: () => void = () => {},
  reader: Accessor<ReaderState | undefined> = () => undefined,
  restoreReader: (
    address: { readonly source: string; readonly path: string },
    surface?: "details",
  ) => void = () => {},
  landWorkspaceSkill: (selection: SkillAddress | undefined) => void = (selection) =>
    pages.workspace.land("skills", selection),
  restoreReaderState: (state: ReaderState | undefined) => void = () => {},
  updatesState: Accessor<UpdatesState | undefined> = () => undefined,
  restoreUpdatesState: (state: UpdatesState) => void = () => {},
) {
  const objectFor = (context: NavigationContext, section: RouteTarget["section"]) => {
    if (context === "workspace")
      return section === "skills"
        ? pages.workspace.selectedSkill()
        : section === "sources"
          ? pages.workspace.selectedSource()
          : section === "collections"
            ? pages.collections?.selected()
            : undefined;
    return pages.config.selection(context, section as ConfigSection);
  };
  const capture = (
    context: NavigationContext,
    section: RouteTarget["section"],
    object?: string | SkillAddress,
    handoff?: RouteHandoff,
    surface: NavigationSurface = "browser",
    region: NavigationRegion = "content",
    focus: FocusOwner = focusFor(surface),
  ): NavigationFrame => ({
    context,
    section,
    ...((object ?? objectFor(context, section)) === undefined
      ? {}
      : { object: object ?? objectFor(context, section) }),
    surface,
    region,
    focus,
    ...(handoff ? { handoff } : {}),
    workspace: structuredClone(pages.workspace.snapshot()),
    config: {
      global: structuredClone(pages.config.snapshot("global")),
      project: structuredClone(pages.config.snapshot("project")),
      local: structuredClone(pages.config.snapshot("local")),
    },
    ...(pages.collections ? { collections: structuredClone(pages.collections.snapshot()) } : {}),
    narrowLevel: pages.workspace.narrowLevel(),
    ...(context === "workspace" && section === "skills" && pages.workspace.readerOpen() && reader()
      ? { reader: structuredClone(reader()!) }
      : {}),
    ...(context === "workspace" && section === "updates" && updatesState()
      ? { updatesState: updatesState() }
      : {}),
  });
  const [snapshot, setSnapshot] = createSignal<RouteSnapshot>({
    current: capture("workspace", pages.workspace.section()),
    stack: [],
    destination: "workspace",
    revision: 0,
  });
  const revise = (
    current: RouteSnapshot,
    next: Omit<RouteSnapshot, "revision">,
  ): RouteSnapshot => ({
    ...next,
    revision: current.revision + 1,
  });
  const land = (target: RouteTarget) => {
    if (target.destination === "workspace" && target.section === "skills")
      landWorkspaceSkill(target.selection);
    else if (target.destination === "workspace")
      pages.workspace.land(target.section, target.selection);
    else pages.config.land(target.destination, target.section, target.selection);
  };
  const sameObject = (
    left: string | SkillAddress | undefined,
    right: string | SkillAddress | undefined,
  ) =>
    typeof left === "string" || typeof right === "string"
      ? left === right
      : left === undefined || right === undefined
        ? left === right
        : sameSkillAddress(left, right);
  const sameTarget = (frame: NavigationFrame, target: RouteTarget) =>
    frame.context === target.destination &&
    frame.section === target.section &&
    sameObject(frame.object, target.selection);
  const apply = (
    target: RouteTarget,
    stack: readonly NavigationFrame[],
    landTarget = () => land(target),
    retainPrevious = true,
  ) => {
    const previous = {
      ...capture(
        snapshot().current.context,
        snapshot().current.section,
        snapshot().current.object,
        snapshot().current.handoff,
        snapshot().current.surface,
        snapshot().current.region,
        snapshot().current.focus,
      ),
      // A navigation action may select a new update draft before it pushes the
      // destination. Keep the frame's actual predecessor draft, not whichever
      // effects draft happened to become active in that same event turn.
      ...(snapshot().current.updatesState ? { updatesState: snapshot().current.updatesState } : {}),
    };
    const surface: NavigationSurface =
      target.surface ?? (target.handoff?.kind === "agent-producer" ? "inspector" : "browser");
    batch(() => {
      landTarget();
      dismissOverlay();
      const current = capture(
        target.destination,
        target.section,
        target.selection,
        target.handoff,
        surface,
        target.region ?? "content",
        target.focus ?? focusFor(surface),
      );
      setSnapshot((before) => {
        const result = revise(before, {
          current,
          stack: retainPrevious ? [...stack.slice(0, -1), previous] : stack,
          destination: target.destination,
          ...(target.handoff ? { handoff: target.handoff } : {}),
        });
        return result;
      });
      requestFocus(target.focus ?? focusFor(surface));
    });
  };
  const restore = (frame: NavigationFrame, stack: readonly NavigationFrame[]) => {
    batch(() => {
      pages.workspace.restore(frame.workspace);
      pages.config.restore("global", frame.config.global);
      pages.config.restore("project", frame.config.project);
      pages.config.restore("local", frame.config.local);
      if (frame.collections && pages.collections) pages.collections.restore(frame.collections);
      if (frame.reader?.address) {
        restoreReader(frame.reader.address, frame.reader.tab === "details" ? "details" : undefined);
        if (frame.reader.tab === "details") pages.workspace.openReader();
        restoreReaderState(frame.reader);
      }
      if (frame.updatesState) restoreUpdatesState(frame.updatesState);
      const restoredFocus =
        frame.focus === "reader-resource-content" &&
        reader()?.tab === "resources" &&
        reader()?.resourceLevel !== "content"
          ? "reader"
          : frame.focus;
      setSnapshot((current) => {
        const result = revise(current, {
          ...current,
          current: { ...frame, focus: restoredFocus },
          stack,
          destination: frame.context,
          ...(frame.handoff ? { handoff: frame.handoff } : {}),
        });
        return result;
      });
      dismissOverlay();
      if (frame.narrowLevel === "list") pages.workspace.showList();
      else if (frame.narrowLevel === "work-area") pages.workspace.showWorkArea();
      else if (frame.narrowLevel === "detail") pages.workspace.openDetail();
      requestFocus(restoredFocus);
    });
  };
  const syncCurrent = (
    patch: Partial<
      Pick<NavigationFrame, "section" | "object" | "surface" | "region" | "focus">
    > = {},
  ) =>
    setSnapshot((current) => {
      const section = patch.section ?? current.current.section;
      const context = current.current.context;
      const object = patch.object ?? objectFor(context, section);
      const surface = patch.surface ?? current.current.surface;
      if (
        section === current.current.section &&
        sameObject(object, current.current.object) &&
        surface === current.current.surface &&
        (patch.region ?? current.current.region) === current.current.region &&
        (patch.focus ?? current.current.focus) === current.current.focus
      )
        return current;
      const next: NavigationFrame = {
        ...current.current,
        ...patch,
        object,
        workspace: structuredClone(pages.workspace.snapshot()),
        config: {
          global: structuredClone(pages.config.snapshot("global")),
          project: structuredClone(pages.config.snapshot("project")),
          local: structuredClone(pages.config.snapshot("local")),
        },
        ...(pages.collections
          ? { collections: structuredClone(pages.collections.snapshot()) }
          : {}),
        narrowLevel: pages.workspace.narrowLevel(),
        ...(surface === "reader" && reader()
          ? { reader: structuredClone(reader()!) }
          : { reader: undefined }),
        ...(context === "workspace" && section === "updates" && updatesState()
          ? { updatesState: updatesState() }
          : { updatesState: undefined }),
      };
      const result = { ...current, current: next };
      return result;
    });

  const available = (frame: NavigationFrame, projection: ManagementProjection) => {
    if (frame.object === undefined) return true;
    if (typeof frame.object !== "string") {
      const address = frame.object;
      return projection.installedSkills.some((skill) => sameSkillAddress(skill.address, address));
    }
    if (frame.context === "workspace") {
      if (frame.section === "sources")
        return projection.effective.sources.some((source) => source.id === frame.object);
      if (frame.section === "collections")
        return projection.effective.collections.includes(frame.object);
      return true;
    }
    const config = projection.configs.find((item) => item.level === frame.context);
    if (!config) return false;
    if (frame.section === "sources")
      return [...config.direct.sources, ...config.contributed.sources].some(
        (source) => source.id === frame.object,
      );
    if (frame.section === "config-sources")
      return config.direct.configSources.some((source) => source.owner.pointer === frame.object);
    if (frame.section === "collections")
      return [
        ...config.direct.collections.map((collection) => collection.id),
        ...config.contributed.collections,
      ].includes(frame.object);
    return [
      ...config.direct.integrations.map((integration) =>
        configDeclarationOwnerKey(integration.owner),
      ),
      ...(projection.effective.agent.integration ?? []).map((owner) =>
        configDeclarationOwnerKey(owner),
      ),
    ].includes(frame.object);
  };
  const recover = (frame: NavigationFrame): NavigationFrame => ({
    ...frame,
    object: undefined,
    surface: "browser",
    region: "content",
    focus: "browser",
    workspace: { ...frame.workspace, readerOpen: false, selectedSkill: undefined },
    reader: undefined,
    recovery: "unavailable",
  });

  // Shell navigation chooses a workspace, not a predecessor in a drilldown.
  // Keep durable browser state, but leave all transient detail surfaces behind.
  const openRoot = (
    destination: Destination,
    section: RouteTarget["section"],
    focus: FocusOwner,
  ) => {
    apply(
      { destination, section, focus } as RouteTarget,
      [],
      () => {
        pages.workspace.closeReader();
        pages.workspace.showList();
        pages.collections?.closeInspector();
        pages.collections?.closeFilter();
        if (destination === "workspace") {
          if (pages.workspace.sourceFilter()) pages.workspace.clearSourceFilter();
          pages.workspace.selectSection(section as WorkspaceSection);
        } else {
          pages.config.selectSection(destination, section as ConfigSection);
          pages.config.backConfigSourceSurface(destination);
          pages.config.closeIntegrationSurface(destination);
        }
      },
      false,
    );
  };

  return {
    snapshot,
    canReturn: () => snapshot().stack.length > 0,
    syncCurrent,
    transition(target: RouteTarget, landing: () => void) {
      if (!validTarget(target)) return;
      apply(target, [...snapshot().stack, snapshot().current], landing);
    },
    revalidate(projection: ManagementProjection) {
      setSnapshot((current) => {
        const nextCurrent = available(current.current, projection)
          ? current.current
          : recover(current.current);
        const nextStack = current.stack.map((frame) =>
          available(frame, projection) ? frame : recover(frame),
        );
        const result =
          nextCurrent === current.current &&
          nextStack.every((frame, index) => frame === current.stack[index])
            ? current
            : revise(current, { ...current, current: nextCurrent, stack: nextStack });
        return result;
      });
    },
    switchContext(destination: Destination, focus: FocusOwner = "browser") {
      const current = snapshot();
      if (
        destination === current.current.context &&
        current.current.surface === "browser" &&
        !current.stack.length
      )
        return;
      const section =
        destination === "workspace" ? pages.workspace.section() : pages.config.section(destination);
      openRoot(destination, section, focus);
    },
    switchSection(section: RouteTarget["section"], focus: FocusOwner = "browser") {
      const current = snapshot();
      const destination = current.current.context;
      if (!validTarget({ destination, section } as RouteTarget)) return;
      if (
        current.current.section === section &&
        current.current.surface === "browser" &&
        !current.stack.length
      )
        return;
      openRoot(destination, section, focus);
    },
    activate(target: RouteTarget) {
      if (!validTarget(target) || sameTarget(snapshot().current, target)) return;
      apply(target, [...snapshot().stack, snapshot().current]);
    },
    push(target: RouteTarget) {
      if (!validTarget(target)) return;
      apply(target, [...snapshot().stack, snapshot().current]);
    },
    source(target: RouteTarget) {
      this.push(target);
    },
    relationship(target: RelationshipTarget) {
      const active = reader();
      const selected = pages.workspace.selectedSkill();
      if (!active?.address || !selected || !sameSkillAddress(active.address, selected)) return;
      pages.workspace.openReader();
      // Capture Reader Details before the destination replaces its native control.
      this.syncCurrent({
        region: "content",
        focus: target.returnFocus,
      });
      this.push(
        target.destination === "workspace" && target.section === "sources"
          ? { ...target, surface: "inspector", focus: target.focus ?? "inspector" }
          : target,
      );
    },
    contribution(target: RouteTarget) {
      this.push(target);
    },
    restore,
    back() {
      const prior = snapshot();
      const frame = prior.stack.at(-1);
      if (!frame) return;
      restore(frame, prior.stack.slice(0, -1));
    },
  };
}
