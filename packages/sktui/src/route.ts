import { batch, createSignal, type Accessor } from "solid-js";
import type { ConfigDeclarationOwner, WorkspaceView } from "@skctl/core";
import {
  validSections,
  type ConfigSection,
  type Destination,
  type FocusOwner,
  type NavigationContext,
  type NavigationRegion,
  type NavigationSurface,
  type MainPage,
  type ReaderState,
  type RouteHandoff,
  sameSkillAddress,
  type SkillAddress,
  type WorkspaceSection,
} from "./types";
import type { WorkspaceSnapshot, WorkspaceState } from "./workspace/state";
import type { ConfigSnapshot, ConfigState } from "./config/state";
import type { CollectionsSnapshot, CollectionsState } from "./collections/state";
import type { UpdatesState } from "./updates/state";
import type { UpdateScopeEntry } from "./updates/scope";

export type RouteSublocation =
  | { readonly kind: "problems" }
  | { readonly kind: "updates"; readonly entry: UpdateScopeEntry; readonly source?: string }
  | { readonly kind: "problem"; readonly key: string };

export type RouteTarget = (
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
    }
) & {
  /** Desired route-owned layer, when a landing changes it after navigation starts. */
  readonly sublocation?: RouteSublocation;
};

export interface NavigationFrame {
  readonly page: MainPage;
  readonly context: NavigationContext;
  readonly section: RouteTarget["section"];
  readonly object?: string | SkillAddress;
  readonly surface: NavigationSurface;
  readonly region: NavigationRegion;
  readonly focus: FocusOwner;
  readonly handoff?: RouteHandoff;
  readonly sublocation?: RouteSublocation;
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

const surfaceFor = (target: RouteTarget): NavigationSurface =>
  target.surface ?? (target.handoff?.kind === "agent-producer" ? "inspector" : "browser");

const ownerIdentity = (owner: ConfigDeclarationOwner): readonly unknown[] => [
  owner.level,
  owner.file,
  owner.pointer,
  owner.namespace,
  contributionIdentity(owner.contribution),
];
const contributionIdentity = (
  contribution: ConfigDeclarationOwner["contribution"],
): readonly unknown[] | undefined =>
  contribution
    ? [
        ownerIdentity(contribution.configSource),
        contribution.declaration.level,
        contribution.declaration.file,
        contribution.declaration.pointer,
        contribution.declaration.namespace,
      ]
    : undefined;

/** Only content/ownership identity: not display descriptions or the path taken here. */
const handoffKey = (handoff: RouteHandoff | undefined): string | undefined => {
  if (!handoff) return undefined;
  const address = (value: SkillAddress) => [value.source, value.path];
  if (handoff.kind === "agent-producer")
    return JSON.stringify([handoff.kind, address(handoff.address)]);
  const owner = ownerIdentity(handoff.owner);
  switch (handoff.kind) {
    case "collection-membership":
    case "uninstall-membership":
      return JSON.stringify([
        handoff.kind,
        owner,
        address(handoff.address),
        handoff.collection,
        handoff.entry,
      ]);
    case "agent-membership":
    case "agent-link":
    case "agent-use":
      return JSON.stringify([
        handoff.kind,
        owner,
        handoff.collection,
        handoff.entry,
        handoff.linkedCollection,
      ]);
    case "collection-reference":
      return JSON.stringify([
        handoff.kind,
        owner,
        handoff.collection,
        handoff.name,
        handoff.target,
      ]);
    case "source-declaration":
    case "source-contribution":
      return JSON.stringify([
        handoff.kind,
        owner,
        handoff.source.id,
        handoff.source.kind,
        handoff.source.origin,
        handoff.source.root,
        handoff.source.ref,
        handoff.source.selectors,
        contributionIdentity(handoff.source.contribution),
      ]);
  }
};

const sublocationKey = (location: RouteSublocation | undefined): string | undefined => {
  if (!location) return undefined;
  if (location.kind === "problems") return "problems";
  if (location.kind === "problem") return JSON.stringify([location.kind, location.key]);
  const entry = location.entry;
  return JSON.stringify([
    location.kind,
    entry.kind,
    entry.kind === "source"
      ? entry.source
      : entry.kind === "collection"
        ? entry.collection
        : entry.kind === "skill"
          ? [entry.address.source, entry.address.path]
          : entry.kind === "selected"
            ? entry.addresses.map((address) => [address.source, address.path])
            : undefined,
    location.source,
  ]);
};

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
  restoreReader: (address: { readonly source: string; readonly path: string }) => void = () => {},
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
  const sublocationFor = (
    context: NavigationContext,
    section: RouteTarget["section"],
    surface: NavigationSurface,
  ): RouteSublocation | undefined => {
    if (context !== "workspace") return undefined;
    if (section === "updates") {
      const state = updatesState();
      if (state)
        return {
          kind: "updates",
          entry: structuredClone(state.scope.entry),
          source: pages.workspace.snapshot().sourceUpdatesSource,
        };
    }
    const key = pages.workspace.diagnosticDetail();
    return section === "skills" && surface === "inspector" && key
      ? { kind: "problem", key }
      : section === "skills" && pages.workspace.skillsView() === "problems"
        ? { kind: "problems" }
        : undefined;
  };
  const capture = (
    context: NavigationContext,
    section: RouteTarget["section"],
    object?: string | SkillAddress,
    handoff?: RouteHandoff,
    surface: NavigationSurface = "browser",
    region: NavigationRegion = "content",
    focus: FocusOwner = focusFor(surface),
    sublocation = sublocationFor(context, section, surface),
  ): NavigationFrame => ({
    page:
      context === "workspace"
        ? (section as WorkspaceSection)
        : section === "integrations"
          ? "agent"
          : "settings",
    context,
    section,
    ...((object ?? objectFor(context, section)) === undefined
      ? {}
      : { object: object ?? objectFor(context, section) }),
    surface,
    region,
    focus,
    ...(handoff ? { handoff: structuredClone(handoff) } : {}),
    sublocation: sublocation ? structuredClone(sublocation) : undefined,
    workspace: structuredClone(pages.workspace.snapshot()),
    config: {
      global: structuredClone(pages.config.snapshot("global")),
      project: structuredClone(pages.config.snapshot("project")),
      local: structuredClone(pages.config.snapshot("local")),
    },
    ...(pages.collections ? { collections: structuredClone(pages.collections.snapshot()) } : {}),
    narrowLevel: pages.workspace.narrowLevel(),
    ...(context === "workspace" &&
    (section === "skills" || section === "agent") &&
    pages.workspace.readerOpen() &&
    reader()
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
    else if (target.destination === "workspace") {
      pages.workspace.land(target.section, target.selection);
      if (target.section === "collections" && target.selection !== undefined)
        pages.collections?.select(target.selection);
    } else pages.config.land(target.destination, target.section, target.selection);
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
    sameObject(frame.object, target.selection ?? objectFor(target.destination, target.section)) &&
    frame.surface === surfaceFor(target) &&
    handoffKey(frame.handoff) === handoffKey(target.handoff) &&
    sublocationKey(frame.sublocation) ===
      sublocationKey(
        target.sublocation ??
          sublocationFor(target.destination, target.section, surfaceFor(target)),
      );
  const workspaceForPrevious = (
    active: NavigationFrame,
    live: WorkspaceSnapshot,
  ): WorkspaceSnapshot => ({
    ...live,
    // Problems opens the destination detail before push. Refresh browsing
    // preferences, but do not put that new detail into the predecessor.
    ...(active.context === "workspace" && active.section === "skills"
      ? {
          diagnosticDetail:
            active.sublocation?.kind === "problem" ? active.sublocation.key : undefined,
          ...(active.sublocation?.kind === "problem"
            ? { selectedProblem: active.sublocation.key }
            : {}),
        }
      : {}),
    // Retain the predecessor Source if this event already changed its identity.
    ...(active.context === "workspace" &&
    active.section === "updates" &&
    live.sourceUpdatesSource !== active.workspace.sourceUpdatesSource
      ? { sourceUpdatesSource: active.workspace.sourceUpdatesSource }
      : {}),
  });
  const apply = (
    target: RouteTarget,
    stack: readonly NavigationFrame[],
    landTarget = () => land(target),
    retainPrevious = true,
  ) => {
    const active = snapshot().current;
    const captured = capture(
      active.context,
      active.section,
      active.object,
      active.handoff,
      active.surface,
      active.region,
      active.focus,
    );
    const previous: NavigationFrame = {
      ...captured,
      sublocation: active.sublocation,
      workspace: workspaceForPrevious(active, captured.workspace),
      // A navigation action may select a new update draft before it pushes the
      // destination. Keep the frame's actual predecessor draft, not whichever
      // effects draft happened to become active in that same event turn.
      ...(active.context === "workspace" && active.section === "updates"
        ? { updatesState: active.updatesState }
        : {}),
    };
    const surface = surfaceFor(target);
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
        target.sublocation,
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
        restoreReader(frame.reader.address);
        if (frame.reader.installationOpen) pages.workspace.openReader();
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
          handoff: frame.handoff,
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
        page:
          context === "workspace"
            ? (section as WorkspaceSection)
            : section === "integrations"
              ? "agent"
              : "settings",
        object,
        workspace: structuredClone(
          section === current.current.section && surface === current.current.surface
            ? workspaceForPrevious(current.current, pages.workspace.snapshot())
            : pages.workspace.snapshot(),
        ),
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
        sublocation:
          section !== current.current.section || surface !== current.current.surface
            ? sublocationFor(context, section, surface)
            : current.current.sublocation,
        ...(context === "workspace" && section === "updates"
          ? {
              updatesState:
                section === current.current.section ? current.current.updatesState : updatesState(),
            }
          : { updatesState: undefined }),
      };
      const result = { ...current, current: next };
      return result;
    });

  const available = (frame: NavigationFrame, projection: WorkspaceView) => {
    if (frame.section === "integrations") return true;
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
    return false;
  };
  const recover = (frame: NavigationFrame): NavigationFrame => ({
    ...frame,
    object: undefined,
    handoff: undefined,
    sublocation: undefined,
    surface: "browser",
    region: "content",
    focus: "browser",
    narrowLevel: "list",
    workspace: { ...frame.workspace, readerOpen: false, selectedSkill: undefined },
    reader: undefined,
    recovery: "unavailable",
  });

  const mainPages = new Map<
    MainPage,
    { frame: NavigationFrame; stack: readonly NavigationFrame[] }
  >();

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
        pages.workspace.setCollectionBrowserOpen(false);
        pages.workspace.closeDiagnosticDetail();
        pages.workspace.clearSourceUpdatesView();
        pages.collections?.closeInspector();
        pages.collections?.closeFilter();
        if (destination === "workspace") {
          if (pages.workspace.sourceFilter()) pages.workspace.clearSourceFilter();
          pages.workspace.selectSection(section as WorkspaceSection);
        } else {
          pages.config.selectSection(destination, section as ConfigSection);
          pages.config.backConfigSourceSurface(destination);
        }
      },
      false,
    );
  };

  const hasTransientSurface = (destination: Destination) =>
    pages.workspace.readerOpen() ||
    pages.workspace.collectionBrowserOpen() ||
    !!pages.workspace.diagnosticDetail() ||
    pages.workspace.snapshot().sourceUpdatesSource !== undefined ||
    !!pages.collections?.inspector() ||
    !!pages.collections?.filter().open ||
    (destination !== "workspace" && pages.config.configSourceSurface(destination) !== "list");

  return {
    snapshot,
    canReturn: () => snapshot().stack.length > 0,
    syncCurrent,
    transition(target: RouteTarget, landing: () => void) {
      if (!validTarget(target)) return;
      // Existing Updates landings establish a Source layer only inside the
      // callback. Without its desired identity, ordinary target equality cannot
      // prove a no-op. Callers can supply sublocation for pre-landing comparison.
      if (
        !(
          target.destination === "workspace" &&
          target.section === "updates" &&
          !target.sublocation
        ) &&
        sameTarget(snapshot().current, target)
      )
        return;
      apply(target, [...snapshot().stack, snapshot().current], landing);
    },
    revalidate(projection: WorkspaceView) {
      for (const [page, saved] of mainPages)
        mainPages.set(page, {
          frame: available(saved.frame, projection) ? saved.frame : recover(saved.frame),
          stack: saved.stack.map((frame) =>
            available(frame, projection) ? frame : recover(frame),
          ),
        });
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
    switchPage(page: MainPage) {
      const active = snapshot().current;
      if (page === active.page) return;
      mainPages.set(active.page, {
        frame: capture(
          active.context,
          active.section,
          undefined,
          active.handoff,
          active.surface,
          active.region,
          active.focus,
        ),
        stack: snapshot().stack,
      });
      const entry = mainPages.get(page);
      if (!entry) {
        openRoot(
          page === "settings" ? "global" : "workspace",
          page === "settings" ? "sources" : page,
          "local-nav",
        );
        return;
      }
      const saved = entry.frame;
      // Page owners keep their current data. Restore only the navigation fields
      // shared by several pages, never an old copy of selections or task results.
      const workspace = pages.workspace.snapshot();
      const config = {
        global: pages.config.snapshot("global"),
        project: pages.config.snapshot("project"),
        local: pages.config.snapshot("local"),
      };
      if (saved.context !== "workspace")
        config[saved.context] = {
          ...config[saved.context],
          section: saved.section as ConfigSection,
          browserLevel: saved.config[saved.context].browserLevel,
          configSourceSurface: saved.config[saved.context].configSourceSurface,
        };
      restore(
        {
          ...saved,
          workspace: {
            ...workspace,
            section:
              saved.context === "workspace"
                ? (saved.section as WorkspaceSection)
                : workspace.section,
            selectedSkill: saved.workspace.selectedSkill,
            readerOpen: saved.workspace.readerOpen,
            sourceFilter: saved.workspace.sourceFilter,
            diagnosticDetail: saved.workspace.diagnosticDetail,
            sourceUpdatesSource: saved.workspace.sourceUpdatesSource,
          },
          config,
          collections: pages.collections
            ? {
                ...pages.collections.snapshot(),
                inspector: page === "collections" ? saved.collections?.inspector : undefined,
              }
            : undefined,
        },
        entry.stack,
      );
    },
    switchContext(destination: Destination, focus: FocusOwner = "browser") {
      const current = snapshot();
      if (
        destination === current.current.context &&
        current.current.surface === "browser" &&
        !current.stack.length &&
        !current.current.handoff &&
        !(current.current.sublocation?.kind === "updates" && current.current.sublocation.source) &&
        !hasTransientSurface(destination)
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
        !current.stack.length &&
        !current.current.handoff &&
        !(current.current.sublocation?.kind === "updates" && current.current.sublocation.source) &&
        !hasTransientSurface(destination)
      )
        return;
      openRoot(destination, section, focus);
    },
    activate(target: RouteTarget) {
      if (!validTarget(target) || sameTarget(snapshot().current, target)) return;
      apply(target, [...snapshot().stack, snapshot().current]);
    },
    push(target: RouteTarget) {
      if (!validTarget(target) || sameTarget(snapshot().current, target)) return;
      apply(target, [...snapshot().stack, snapshot().current]);
    },
    source(target: RouteTarget) {
      this.push(target);
    },
    relationship(target: RelationshipTarget) {
      const active = reader();
      const selected = pages.workspace.selectedSkill();
      if (!active?.address || !selected || !sameSkillAddress(active.address, selected)) return;
      const destination: RouteTarget =
        target.destination === "workspace" && target.section === "sources"
          ? { ...target, surface: "inspector", focus: target.focus ?? "inspector" }
          : target;
      if (!validTarget(destination) || sameTarget(snapshot().current, destination)) return;
      pages.workspace.openReader();
      // Capture Reader Details before the destination replaces its native control.
      this.syncCurrent({
        region: "content",
        focus: target.returnFocus,
      });
      this.push(destination);
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
