import {
  createCliRenderer,
  InputRenderable,
  SelectRenderable,
  ScrollBoxRenderable,
  Renderable,
} from "@opentui/core";
import { onResize, render, useKeyboard, useRenderer } from "@opentui/solid";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import type {
  ConfigSourceObservation,
  ConfigSourceImpact,
  ManagementProjection,
  SkillCliCore,
} from "@skill-cli/core";
import type { SkillAddress } from "@skill-cli/core";
import {
  actionIntent,
  installedSkillContext,
  skillCollectionTargets,
  reachableActions,
  selectedConfigIntegrationOwner,
  selectedSourceContext,
  sourceRouteIntent,
  sourceOperationIntent,
  type ActionId,
} from "./actions";
import {
  createTuiEffects,
  type SourceRemovalReview,
  type DiscoveryReview,
  type InstalledSkillReview,
  type TuiCore,
} from "./effects";
import type { UpdateScopeEntry } from "./updates/scope";
import {
  destinations,
  readerOwnsFocus,
  sameSkillAddress,
  validSections,
  type Destination,
  type FocusOwner,
  type CommandRecord,
  type ConfigSection,
  type Section,
} from "./types";
import {
  SourceRemovalOverlay,
  SourceObservationOverlay,
  SourceSelectionOverlay,
  CollectionCreateOverlay,
  InstalledSkillPreviewFailureOverlay,
  InstalledSkillPreviewOverlay,
  InstalledSkillReviewOverlay,
  RebindSourceOverlay,
  CollectionHandoffOverlay,
  CollectionReviewOverlay,
  MembershipBatchDraftOverlay,
  MembershipRemovalPlanOverlay,
  InstalledSkillChooserOverlay,
  SourceRegistrationOverlay,
  CollectionImportOverlay,
  ReferenceOverlay,
  LinkChangeOverlay,
  CollectionUseOverlay,
  ModalCommand,
  type InstalledSkillPreviewRequest,
} from "./operations";
import { WorkspacePage } from "./workspace-page";
import { createCommandRegistry, type ExecutableCommand } from "./commands";
import { PageNavigationProvider, type PageNavigation, type PageReturn } from "./page-navigation";
import { CommandPalette, paletteCloseCommand, paletteSearchCommand } from "./command-palette";
import { ConfigPage } from "./config-page";
import { filterSkills } from "./skills-filter";
import {
  collectionRemovalPlan,
  type CollectionRelationshipIntent,
  type CollectionRemovalRow,
} from "./collections-page";
import { createFocus } from "./focus";
import { createLayout } from "./layout";
import { createProjection } from "./projection";
import { createWorkspaceState } from "./workspace/state";
import { createCollectionsState } from "./collections/state";
import { deriveAgentAccessTree } from "./collections/agent-access-tree";
import { deriveCollectionFilterTree } from "./collections/collection-filter-tree";
import { configDeclarationOwnerKey, createConfigState } from "./config/state";
import { createOperationState } from "./operation-state";
import { createReaderOwner } from "./reader/state";
import { SectionTabs } from "./components/section-tabs";
import {
  dispatchKeyEvent,
  isPlainNavKey,
  matchesCommandShortcut,
  parseNavKey,
  resolve,
  resolveEscape,
} from "./navigation";
import { keyboardGuidance, type InteractionMode } from "./keyboard-guidance";
import { createRoute, type RelationshipTarget, type RouteTarget } from "./route";
import {
  createOverlaySession,
  reduceOverlaySession,
  sessionMatches as sessionMatchesOverlay,
} from "./overlays/session";
import { theme } from "./ui/theme";
import { useTheme } from "./ui/use-theme";
import { RouteShell, compactControlsBelow, stackedNavigationBelow } from "./ui/route-shell";
import { CommandControl } from "./command-control";
import { DiagnosticLog } from "./diagnostic-log";
import { DataList } from "./ui/data-list";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { selectScrollOffset } from "./select-scroll";
import { SkillsFilterPopup } from "./skills-filter-popup";
import { createPanelNavigation, isMounted } from "./panel-navigation";
import {
  createModalControlRegistry,
  ModalControlsProvider,
  traverseModalControls,
  useModalControl,
  useModalControls,
} from "./modal-controls";

const topOptions = () =>
  destinations.map((value) => ({
    label: value === "workspace" ? "Workspace" : value[0]!.toUpperCase() + value.slice(1),
    value,
  }));

/** Context is chosen explicitly; moving through the menu never changes the route. */
function ScopeChoices(props: {
  readonly current: Destination;
  readonly onSelect: (destination: Destination) => void;
  readonly onClose: () => void;
}) {
  const controls = useModalControls()!;
  const register = useModalControl("scope-choices", controls, 10);
  let choices: SelectRenderable | undefined;
  onCleanup(
    controls.intercept((event, current) => {
      if (current !== choices || !isPlainNavKey(parseNavKey(event))) return false;
      if (event.name === "up" || event.name === "down") {
        if (event.name === "up") choices?.moveUp();
        else choices?.moveDown();
        return true;
      }
      return event.name === "left" || event.name === "right";
    }),
  );
  onMount(() => queueMicrotask(() => choices?.focus()));
  return (
    <box flexDirection="column" minHeight={0}>
      <box flexDirection="row" height={1}>
        <DialogTitle flexGrow={1}>Scope</DialogTitle>
        <ModalCommand
          id="scope-close"
          order={20}
          record={{
            id: "scope.close",
            verb: "Close",
            keys: ["enter"],
            destination: "Current scope",
            scope: "modal",
            enabled: true,
            danger: false,
          }}
          execute={props.onClose}
        />
      </box>
      <DataList
        id="scope-choices"
        ref={(target) => {
          choices = target;
          register(target);
        }}
        options={topOptions().map((option) => ({
          name: `${option.value === props.current ? "✓ " : "  "}${option.label}`,
          description:
            option.value === "workspace" ? "Effective workspace" : "Configuration declarations",
          value: option.value,
        }))}
        selectedIndex={destinations.indexOf(props.current)}
        height={4}
        showDescription={false}
        onSelect={(_index, option) => {
          if (option && destinations.includes(option.value)) props.onSelect(option.value);
        }}
      />
    </box>
  );
}
const configBindingLine = (binding: ConfigSourceImpact["binding"]) =>
  `${binding.kind} ${binding.kind === "local" ? binding.path : binding.origin} ${binding.root}`;

type CollectionReview = import("./effects").CollectionReview;
type CollectionDraft = Extract<
  import("./effects").CollectionIntent,
  {
    readonly kind: "collection-import" | "reference" | "link-change" | "collection-use";
  }
>;

type AppOverlayPayload =
  | { readonly family: "source-removal"; readonly review?: SourceRemovalReview }
  | {
      readonly family: "source-observation";
      readonly intent: ReturnType<typeof sourceOperationIntent>;
    }
  | { readonly family: "config-observation"; readonly id: string }
  | {
      readonly family: "source-selection";
      readonly review: DiscoveryReview;
      readonly selectedPaths: readonly string[];
    }
  | {
      readonly family: "installed-preview";
      readonly request: InstalledSkillPreviewRequest;
      readonly failed?: boolean;
      readonly review?: InstalledSkillReview;
      readonly sourceRemoval?: SourceRemovalReview;
    }
  | {
      readonly family: "installed-rebind";
      readonly sources: readonly string[];
      readonly address: { readonly source: string; readonly path: string };
      readonly sourceRemoval?: SourceRemovalReview;
    }
  | { readonly family: "palette" }
  | { readonly family: "diagnostic-log"; readonly text: string }
  | { readonly family: "skills-filter" }
  | { readonly family: "scope-selection" }
  | {
      readonly family: "collection-choices";
      readonly choices: readonly {
        readonly collection: string;
        readonly level?: "global" | "project" | "local";
        readonly owner?: import("@skill-cli/core").ConfigDeclarationOwner;
      }[];
      readonly addresses: readonly {
        readonly source: string;
        readonly path: string;
      }[];
    }
  | {
      readonly family: "collection-create";
      readonly level?: "global" | "project" | "local";
      readonly file?: string;
      readonly allowedLevels?: readonly ("global" | "project" | "local")[];
      readonly fixedCollection?: boolean;
      readonly afterCreate?: {
        readonly collection: string;
        readonly addresses: readonly {
          readonly source: string;
          readonly path: string;
        }[];
      };
    }
  | {
      readonly family: "membership-chooser";
      readonly level: "global" | "project" | "local";
      readonly collection: string;
      readonly expectedOwner: import("@skill-cli/core").ConfigDeclarationOwner;
    }
  | {
      readonly family: "membership-draft";
      readonly level: "global" | "project" | "local";
      readonly collection: string;
      readonly expectedOwner?: import("@skill-cli/core").ConfigDeclarationOwner;
      readonly additions: readonly {
        readonly name: string;
        readonly address: { readonly source: string; readonly path: string };
      }[];
    }
  | {
      readonly family: "membership-removal-plan";
      readonly plan: ReturnType<typeof collectionRemovalPlan>;
    }
  | {
      readonly family: "collection-draft";
      readonly draft: CollectionDraft;
      readonly useCurrent?: string;
    }
  | {
      readonly family: "collection-review";
      readonly review?: CollectionReview;
      readonly removedOriginKeys?: readonly string[];
    }
  | {
      readonly family: "config-operation";
      readonly kind: "adopt" | "forget" | "remove" | "managed";
      readonly id?: string;
      readonly observation?: ConfigSourceObservation;
      readonly impact?: ConfigSourceImpact;
      readonly level?: "global" | "project" | "local";
      readonly file?: string;
      readonly enabled?: boolean;
    }
  | {
      readonly family: "source-registration";
      readonly kind: "source" | "config-source";
      readonly level?: "global" | "project" | "local";
    };

export function App(props: { readonly core: TuiCore; readonly exit: () => void }) {
  const operation = createOperationState();
  const [overlaySession, setOverlaySession] = createSignal(createOverlaySession());
  const overlayKind = () => overlaySession().kind;
  const [transition, setTransition] = createSignal<string | undefined>();
  const readerOwner = createReaderOwner(props.core.content, () => {
    if (physicalFocusOwner() === "reader-resource-content") requestFocus("reader-resource-content");
  });
  const reader = readerOwner.current;
  const workspaceState = createWorkspaceState((selected) => {
    const address = selected
      ? projection
          .workspace()
          ?.installedSkills.find((item) => sameSkillAddress(item.address, selected))?.address
      : undefined;
    if (!address) {
      workspaceState.closeReader();
      workspaceState.showWorkArea();
      if (
        !(renderer.currentFocusedRenderable instanceof InputRenderable) &&
        physicalOwnerFor(renderer.currentFocusedRenderable) !== "collection-tree"
      )
        requestFocus("browser");
      return;
    }
    if (workspaceState.readerOpen()) {
      const changed = !reader()?.address || !sameSkillAddress(reader()!.address!, address);
      selectReaderSkill(address);
      if (changed) readerOwner.patch({ tab: "skill" });
    }
  });
  const collectionsState = createCollectionsState();
  const configState = createConfigState();
  const renderer = useRenderer();
  const stopThemeFollow = theme.follow(renderer);
  const tokens = useTheme();
  const focus = createFocus("browser");
  const focusRegistry = focus.registry;
  const layout = createLayout();
  const [focusVersion, setFocusVersion] = createSignal(focusRegistry.version());
  const [focusedControl, setFocusedControl] = createSignal<Renderable | null>(null);
  const [activeContent, setActiveContent] = createSignal<Renderable>();
  const [pageReturns, setPageReturns] = createSignal<ReadonlyMap<symbol, PageReturn>>(new Map());
  const [pageCommands, setPageCommands] = createSignal<
    ReadonlyMap<symbol, readonly ExecutableCommand[]>
  >(new Map());
  const pageNavigation: PageNavigation = {
    registerReturn(value) {
      const token = Symbol();
      setPageReturns((current) => new Map(current).set(token, value));
      return () =>
        setPageReturns((current) => {
          const next = new Map(current);
          next.delete(token);
          return next;
        });
    },
    registerCommands(value) {
      const token = Symbol();
      setPageCommands((current) => new Map(current).set(token, value));
      return () =>
        setPageCommands((current) => {
          const next = new Map(current);
          next.delete(token);
          return next;
        });
    },
  };
  const [physicalFocusOwner, setPhysicalFocusOwner] = createSignal<FocusOwner | undefined>(
    undefined,
    { equals: false },
  );
  const [readerFocusUnblocked, setReaderFocusUnblocked] = createSignal(0);
  const stopFocusSubscription = focusRegistry.subscribe((version) => {
    setFocusVersion(version);
    syncPhysicalFocus(renderer.currentFocusedRenderable);
  });
  const focusOwner = focus.desired;
  let readerFocusWasBlocked = false;
  let appliedFocusRevision = -1;
  let appliedFocusVersion = -1;
  let shellFocusRevision = 0;
  let pendingShellFocus:
    | {
        readonly revision: number;
        readonly destination: Destination;
        readonly section: Section;
        readonly routeRevision: number;
        readonly listener: () => void;
      }
    | undefined;
  const modalControls = createModalControlRegistry();
  let routeBackBinding: { readonly target: Renderable; readonly cleanup: () => void } | undefined;
  const bindRouteBack = (target: Renderable) => {
    if (routeBackBinding?.target === target) return;
    routeBackBinding?.cleanup();
    const dispose = focusRegistry.register("route-back", target);
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      target.off("destroyed", release);
      dispose();
      if (routeBackBinding?.target === target) routeBackBinding = undefined;
    };
    target.once("destroyed", release);
    routeBackBinding = { target, cleanup: release };
  };
  const registerPageCommand = (
    record: CommandRecord,
    owner: FocusOwner,
    controlId: string,
    execute: () => void,
  ) => {
    return commandRegistry.register(record, owner, controlId, () => {
      if (
        record.id.startsWith("reader.") &&
        route.snapshot().destination === "workspace" &&
        skillWorkspace()
      ) {
        workspaceState.setCollectionBrowserOpen(false);
        if (!layout.wide()) workspaceState.openDetail();
      }
      execute();
    });
  };
  const executePageCommand = (id: string) => {
    const command = commandRegistry.mounted().get(id);
    if (!command?.record.enabled) return;
    route.syncCurrent({
      focus: physicalFocusOwner() ?? "browser",
    });
    command.execute();
  };
  const ownerForTarget = (target: Renderable): FocusOwner | undefined =>
    focusRegistry.ownerOf(target);
  const panels = createPanelNavigation(renderer.root, focusRegistry, (owner) => {
    const target = focusRegistry.target(owner);
    return (
      [...commandRegistry.mounted().values()].find(
        (command) =>
          command.owner === owner &&
          target instanceof Renderable &&
          command.controlId === target.id,
      )?.record.enabled ?? true
    );
  });
  const physicalOwnerFor = (current: Renderable | null): FocusOwner | undefined => {
    if (!current || current.isDestroyed) return undefined;
    const registered = ownerForTarget(current);
    if (registered) return registered;
    if (current instanceof InputRenderable) return "input";
    return undefined;
  };
  let lastPhysicalOwner: FocusOwner | undefined;
  let recoveryFocusRevision: number | undefined;
  const syncPhysicalFocus = (current: Renderable | null) => {
    setFocusedControl(current);
    const owner = physicalOwnerFor(current);
    if (owner && recoveryFocusRevision === focus.revision() && owner !== focus.desired()) {
      // A page has restored real focus after its old control was removed. Do
      // not let orphan recovery subsequently focus a replacement with that ID.
      recoveryFocusRevision = undefined;
      focus.clear();
    }
    if (owner) lastPhysicalOwner = owner;
    panels.observe(current, owner);
    setPhysicalFocusOwner(owner);
    for (let node = current; node; node = node.parent as Renderable | null)
      if (node.id === "route-content") {
        if (current) setActiveContent(current);
        break;
      }
  };
  renderer.on("focused_renderable", syncPhysicalFocus);
  let route: ReturnType<typeof createRoute>;
  const skillWorkspace = () =>
    workspaceState.section() === "skills" &&
    ["all-installed-skills", "unassigned", "current-exposure"].includes(
      workspaceState.skillsView(),
    );
  function cancelPendingShellFocus() {
    shellFocusRevision += 1;
    if (pendingShellFocus) renderer.off("frame", pendingShellFocus.listener);
    pendingShellFocus = undefined;
  }
  const requestFocus = (owner: FocusOwner) => {
    recoveryFocusRevision = undefined;
    if (owner !== "local-nav") cancelPendingShellFocus();
    if (skillWorkspace()) {
      if (owner === "browser") workspaceState.showWorkArea();
      else if ((readerOwnsFocus(owner) || owner === "agent-preview") && !layout.wide())
        workspaceState.openDetail();
    }
    if (route) {
      const readerSurface =
        workspaceState.readerOpen() &&
        route.snapshot().destination === "workspace" &&
        workspaceState.section() === "skills" &&
        !!reader()?.address &&
        !!workspaceState.selectedSkill() &&
        sameSkillAddress(reader()!.address!, workspaceState.selectedSkill()!) &&
        readerOwnsFocus(owner);
      route.syncCurrent({
        focus: owner,
        region: owner === "top-nav" ? "context" : owner === "local-nav" ? "section" : "content",
        // The inline pane's focus does not create a semantic Reader route.
        // Explicit Reader routes keep their predecessor even after pane travel.
        ...(readerSurface && !skillWorkspace() ? { surface: "reader" as const } : {}),
      });
    }
    const target = owner;
    if (
      route.snapshot().destination === "workspace" &&
      workspaceState.section() === "skills" &&
      workspaceState.readerOpen() &&
      reader()?.address &&
      readerOwnsFocus(target)
    ) {
      readerOwner.patch({ focus: target });
    }
    focus.request(target);
  };
  const sourceInspectorFocus = (source: ManagementProjection["effective"]["sources"][number]) => {
    // The destination's registry may not be mounted yet. Request its primary
    // action by identity, never a relationship hidden behind Actions.
    const snapshot = projection.workspace();
    const id = snapshot?.installedSkills.some((skill) => skill.address.source === source.id)
      ? "check-updates"
      : "add-skills";
    return reachableActions("workspace", snapshot, pageActionFacts()).some(
      (action) => action.id === id && action.enabled,
    )
      ? (`command:${id}` as const)
      : ("command:source.details.toggle" as const);
  };
  let effects!: ReturnType<typeof createTuiEffects>;
  route = createRoute(
    {
      workspace: workspaceState,
      config: configState,
      collections: collectionsState,
    },
    requestFocus,
    () => closeSession(),
    reader,
    (address, surface) => {
      if (reader()?.address && !sameSkillAddress(reader()!.address!, address))
        readerOwner.cancelContent();
      readerOwner.select(address, surface);
    },
    (address) => {
      batch(() => {
        // An object drill-down enters the inventory explicitly. Retained page
        // preferences must not reinterpret it as Agent access or Problems.
        if (
          address &&
          (route.snapshot().destination !== "workspace" || workspaceState.section() !== "skills")
        )
          workspaceState.selectSkillsView("all-installed-skills");
        workspaceState.land("skills", address);
        if (address) {
          selectReaderSkill(address);
          workspaceState.openReader();
          if (!layout.wide()) workspaceState.openDetail();
        }
      });
      requestFocus(address ? "reader" : "browser");
    },
    (state) => {
      if (!state?.address) return;
      readerOwner.restore(state);
    },
    () => effects?.updates(),
    (state) => {
      const workspace = projection.workspace();
      if (workspace) effects.restoreUpdatesScope(state, workspace);
    },
  );
  createEffect(() => {
    const blocked = !!overlaySession().kind || !!operation.task();
    if (readerFocusWasBlocked && !blocked && focusOwner() && readerOwnsFocus(focusOwner()!))
      setReaderFocusUnblocked((value) => value + 1);
    readerFocusWasBlocked = blocked;
  });
  const routeMatches = (target: RouteTarget) => {
    if (route.snapshot().destination !== target.destination) return false;
    if (target.destination === "workspace") {
      if (workspaceState.section() !== target.section) return false;
      if (target.selection === undefined) return true;
      if (target.section === "skills") {
        const selected = workspaceState.selectedSkill();
        return !!selected && sameSkillAddress(selected, target.selection);
      }
      return (
        (target.section === "sources"
          ? workspaceState.selectedSource()
          : collectionsState.selected()) === target.selection
      );
    }
    return (
      configState.section(target.destination) === target.section &&
      (target.selection === undefined ||
        configState.selection(target.destination, target.section) === target.selection)
    );
  };
  const routeSource = (target: RouteTarget) => {
    const before = route.snapshot();
    route.source(target);
    if (route.snapshot() !== before && routeMatches(target))
      setTransition(
        target.handoff?.kind === "agent-producer"
          ? `Agent producer handoff  ${target.handoff.address.source}/${target.handoff.address.path}`
          : `Opened ${routeTargetLabel(target)}`,
      );
  };
  const routeRelationship = (target: RelationshipTarget) => {
    const before = route.snapshot();
    route.relationship(target);
    if (route.snapshot() !== before && routeMatches(target))
      setTransition(`Opened ${routeTargetLabel(target)}`);
  };
  const projection = createProjection(
    operation,
    {
      workspace: workspaceState,
      collections: collectionsState,
      config: configState,
    },
    route.revalidate,
  );
  const reconcileWorkspaceSelection = () => {
    const current = projection.workspace();
    if (current) workspaceState.reconcile(current, current);
  };
  const reconcileCollectionSelection = () => {
    const current = projection.workspace();
    if (current) collectionsState.reconcile(current, current);
  };
  effects = createTuiEffects(props.core, operation, {
    ...projection.outcomes,
    applyProjection: (snapshot) => {
      batch(() => {
        const changed = (projection.workspace()?.installedSkills ?? []).filter((previous) => {
          const next = snapshot.installedSkills.find((item) =>
            sameSkillAddress(item.address, previous.address),
          );
          return (
            !next ||
            !!previous.owner.relevantLocalRoot ||
            !!next.owner.relevantLocalRoot ||
            previous.owner.relevantRemoteRevision !== next.owner.relevantRemoteRevision ||
            previous.owner.source !== next.owner.source
          );
        });
        if (
          changed.some(
            (item) => reader()?.address && sameSkillAddress(item.address, reader()!.address!),
          )
        )
          readerOwner.cancelContent();
        for (const item of changed) readerOwner.invalidate(item.address);
        projection.outcomes.applyProjection(snapshot);
      });
    },
  });
  const openUpdates = (entry: UpdateScopeEntry, check = false) => {
    const workspace = projection.workspace();
    if (!workspace) return;
    // Viewing a task must not restart a stopped process-owned check queue.
    const active = effects.updatesActive();
    const state = effects.selectUpdatesScope(entry, workspace);
    if (!state) {
      if (active) routeSource({ destination: "workspace", section: "updates" });
      return;
    }
    workspaceState.clearSourceUpdatesView();
    routeSource({ destination: "workspace", section: "updates" });
    workspaceState.showWorkArea();
    requestFocus("browser");
    if (check && !active) void effects.checkUpdates();
  };
  const openSourceUpdates = (source: string) => {
    const workspace = projection.workspace();
    if (!workspace) return;
    route.syncCurrent({ surface: "browser", focus: "browser" });
    // Drilling into an update Source is a view of the current bounded request,
    // not a new whole-Source draft (especially for Collection/Skill entry).
    const current = route.snapshot();
    const state =
      current.destination === "workspace" && current.current.section === "updates"
        ? effects.updates()
        : effects.selectUpdatesScope({ kind: "source", source }, workspace);
    if (
      !state ||
      !(
        state.scope.sources.includes(source) ||
        (state.scope.entry.kind === "source" && state.scope.entry.source === source)
      )
    )
      return;
    route.transition(
      {
        destination: "workspace",
        section: "updates",
        surface: "browser",
        focus: "browser",
        sublocation: { kind: "updates", entry: state.scope.entry, source },
      },
      () => {
        workspaceState.showWorkArea();
        workspaceState.showSourceUpdates(source);
      },
    );
  };
  const activeSourceUpdatesView = () => {
    const view = workspaceState.sourceUpdatesView();
    const scope = effects.updates()?.scope;
    return view &&
      scope &&
      (scope.sources.includes(view.source) ||
        (scope.entry.kind === "source" && scope.entry.source === view.source))
      ? view
      : undefined;
  };
  const showUpdateTask = () => {
    const workspace = projection.workspace();
    const entry = effects.updateTaskEntry();
    if (!workspace || !entry || !effects.selectUpdatesScope(entry, workspace)) return;
    workspaceState.clearSourceUpdatesView();
    routeSource({ destination: "workspace", section: "updates" });
    workspaceState.showWorkArea();
    requestFocus("browser");
  };
  const sessionPayload = () => overlaySession().payload as AppOverlayPayload | undefined;
  const payload = <Family extends AppOverlayPayload["family"]>(family: Family) => {
    const value = sessionPayload();
    return value?.family === family
      ? (value as Extract<AppOverlayPayload, { readonly family: Family }>)
      : undefined;
  };
  const collectionChoices = () => payload("collection-choices")?.choices;
  const collectionDraftPayload = () => payload("collection-draft");
  const collectionReviewPayload = () => payload("collection-review");
  const collectionCreate = () => payload("collection-create");
  const membershipChooser = () => payload("membership-chooser");
  const membershipDraft = () => payload("membership-draft");
  const membershipRemovalPlan = () => payload("membership-removal-plan");
  const collectionDraft = () => collectionDraftPayload()?.draft;
  const collectionImportDraft = () => {
    const draft = collectionDraft();
    return draft?.kind === "collection-import" ? draft : undefined;
  };
  const collectionReferenceDraft = () => {
    const draft = collectionDraft();
    return draft?.kind === "reference" ? draft : undefined;
  };
  const collectionLinkDraft = () => {
    const draft = collectionDraft();
    return draft?.kind === "link-change" ? draft : undefined;
  };
  const collectionUseDraft = () => {
    const draft = collectionDraft();
    return draft?.kind === "collection-use" ? draft : undefined;
  };
  const availableUseCollections = createMemo(() => {
    const effective = projection.workspace()?.effective;
    return effective?.status === "complete" ? effective.collectionsView : [];
  });
  const collectionReview = () => collectionReviewPayload()?.review;
  const configOperation = () => payload("config-operation");
  const sourceRegistration = () => payload("source-registration");
  const sourceRemovalPayload = () => payload("source-removal");
  const sourceObservationPayload = () => payload("source-observation");
  const configObservationPayload = () => payload("config-observation");
  const sourceSelectionPayload = () => payload("source-selection");
  const installedPreviewPayload = () => payload("installed-preview");
  const installedRebindPayload = () => payload("installed-rebind");
  const openSession = (
    overlay: import("./types").Overlay,
    payload: AppOverlayPayload,
    phase: "review" | "preview" | "observing" | "executing" = "review",
  ) =>
    batch(() => {
      setOverlaySession((current) =>
        reduceOverlaySession(current, {
          type: "open",
          kind: overlay,
          payload,
          phase,
          restoreFocus: physicalFocusOwner() ?? route.snapshot().current.focus,
        }),
      );
    });
  const openScopeSelection = () => openSession("selection", { family: "scope-selection" });
  const openPalette = () => openSession("palette", { family: "palette" });
  const replaceSession = (
    revision: number,
    payload: AppOverlayPayload,
    phase?: "review" | "preview" | "observing" | "executing" | "cancelling",
  ) =>
    setOverlaySession((current) =>
      reduceOverlaySession(current, {
        type: "replace",
        revision,
        payload,
        phase,
      }),
    );
  const beginSession = (revision: number, phase: "preview" | "observing" | "executing") => {
    let begun = overlaySession();
    setOverlaySession((current) => {
      begun = reduceOverlaySession(current, { type: "begin", revision, phase });
      return begun;
    });
    return begun;
  };
  const settleSession = (
    revision: number,
    requestEpoch: number,
    phase: "review" | "preview" | "observing" | "executing" | "cancelling",
    next?: AppOverlayPayload,
  ) =>
    setOverlaySession((current) =>
      reduceOverlaySession(current, {
        type: "settle",
        revision,
        requestEpoch,
        phase,
        payload: next,
      }),
    );
  const sessionMatches = (
    begun: ReturnType<typeof beginSession>,
    kind: import("./types").Overlay,
    family: AppOverlayPayload["family"],
  ) => sessionMatchesOverlay(overlaySession(), begun, kind, family);
  const closeSession = (revision = overlaySession().revision, restoreOrigin = true) => {
    const current = overlaySession();
    if (!current.kind || current.revision !== revision) return;
    const restoreFocus = current.restoreFocus;
    // A close's captured owner is only valid until another semantic focus request wins.
    const focusRevision = focus.revision();
    const routeRevision = route.snapshot().revision;
    setOverlaySession((session) => reduceOverlaySession(session, { type: "close", revision }));
    if (!restoreOrigin) return;
    queueMicrotask(() => {
      if (
        focus.revision() === focusRevision &&
        route.snapshot().revision === routeRevision &&
        restoreFocus
      )
        requestFocus(restoreFocus);
    });
  };
  const settleFailedExecution = (begun: ReturnType<typeof beginSession>) => {
    const current = overlaySession();
    if (current.revision !== begun.revision || current.requestEpoch !== begun.requestEpoch) return;
    if (current.dismissed) closeSession(begun.revision);
    else settleSession(begun.revision, begun.requestEpoch, "review");
  };
  const setSessionPayload = (next: AppOverlayPayload) =>
    replaceSession(overlaySession().revision, next);
  const selectReaderSkill = (address: SkillAddress) => {
    const current = reader();
    if (!current?.address || !sameSkillAddress(current.address, address)) {
      readerOwner.cancelContent();
      readerOwner.abandonResource();
      readerOwner.select(address);
    }
    const selected = reader();
    if (
      !selected?.loading &&
      !selected?.error &&
      (selected?.text === undefined || selected.rawText === undefined)
    )
      void readerOwner.load(address);
    if (selected?.tab === "resources") ensureResources();
  };
  const selectReaderTab = (tab: import("./types").ReaderState["tab"]) => {
    readerOwner.abandonResource();
    readerOwner.patch({
      tab,
      resourceLevel: "list",
      resourceLoading: false,
      error: undefined,
    });
    setTransition(`Reader view: ${readerTabLabel(tab)}`);
    if (tab === "resources") ensureResources();
  };
  const ensureResources = () => {
    const current = reader();
    if (current?.address && !current.resourcesLoaded && !current.resourceLoading && !current.error)
      void readerOwner.list(current.address);
  };
  const openReaderSkill = (address: SkillAddress, tab?: import("./types").ReaderState["tab"]) => {
    const selected = readerOwner.cached(address);
    const readerFocus: FocusOwner = tab
      ? "reader"
      : selected?.tab === "resources"
        ? selected.resourceLevel === "content"
          ? "reader-resource-content"
          : selected.error || selected.resourceLoading || !selected.resources.length
            ? "reader"
            : "reader-resource-list"
        : selected?.focus &&
            readerOwnsFocus(selected.focus) &&
            selected.focus !== "inspector" &&
            selected.focus !== "details-relationships"
          ? selected.focus
          : "reader";
    route.syncCurrent({ focus: physicalFocusOwner() ?? route.snapshot().current.focus });
    route.transition(
      {
        destination: "workspace",
        section: "skills",
        selection: address,
        surface: "reader",
        focus: readerFocus,
      },
      () =>
        batch(() => {
          workspaceState.showInstalledSkillsFromSource(address.source);
          workspaceState.setQuery("");
          workspaceState.clearFilters();
          workspaceState.clearSourceUpdatesView();
          workspaceState.selectSkill(address);
          workspaceState.openReader();
          selectReaderSkill(address);
          if (tab) readerOwner.patch({ tab, focus: "reader" });
          if (layout.wide()) workspaceState.showWorkArea();
          else workspaceState.openDetail();
        }),
    );
    setTransition("Opened Reader");
  };
  const openInstalledSkillsFromSource = (
    source: string,
    predecessor: RouteTarget,
    focus: FocusOwner,
    surface: "browser" | "inspector" = "inspector",
  ) => {
    const first = projection
      .workspace()
      ?.installedSkills.find((skill) => skill.address.source === source);
    route.syncCurrent({
      section: predecessor.section,
      object: source,
      surface,
      region: "content",
      focus,
    });
    route.transition(
      {
        destination: "workspace",
        section: "skills",
        ...(first ? { selection: first.address } : {}),
        surface: "browser",
        focus: "browser",
      },
      () => {
        batch(() => {
          workspaceState.selectSource(source);
          workspaceState.showInstalledSkillsFromSource(source);
          workspaceState.selectSkill(first?.address);
          workspaceState.closeReader();
          workspaceState.showWorkArea();
        });
      },
    );
  };
  let appliedFocusOwner: FocusOwner | undefined;
  let appliedFocusTarget: unknown;
  let focusReconciliationRevision = 0;
  const currentInstalledPreview = (request: InstalledSkillPreviewRequest) => {
    const workspace = projection.workspace();
    const selected = workspaceState.selectedSkill();
    return !!(
      workspace &&
      !!selected &&
      sameSkillAddress(selected, request.address) &&
      workspace.installedSkills.some(
        (skill) =>
          skill.address.source === request.address.source &&
          skill.address.path === request.address.path,
      ) &&
      (request.kind === "uninstall" ||
        workspace.effective.sources.some(
          (source) => source.id === request.owner && source.id !== request.address.source,
        ))
    );
  };
  const previewInstalled = async (
    request: InstalledSkillPreviewRequest,
    sourceRemoval?: SourceRemovalReview,
  ) => {
    if (overlaySession().phase === "preview" || overlaySession().phase === "executing") return;
    if (!currentInstalledPreview(request)) {
      operation.report({
        code: "TRANSACTION_CONFLICT",
        severity: "warning",
        message: "Installed Skill preview no longer matches the current selection",
      });
      return;
    }
    const removal = sessionPayload();
    const parent =
      sourceRemoval ?? (removal?.family === "source-removal" ? removal.review : undefined);
    openSession(
      "confirm",
      {
        family: "installed-preview",
        request,
        sourceRemoval: parent,
      },
      "preview",
    );
    const begun = beginSession(overlaySession().revision, "preview");
    const { revision, requestEpoch } = begun;
    operation.clearProblem();
    const next = await effects.reviewInstalled(request);
    if (!sessionMatches(begun, "confirm", "installed-preview")) return;
    if (overlaySession().dismissed) return closeSession(revision);
    settleSession(revision, requestEpoch, "review", {
      family: "installed-preview",
      request,
      ...(next ? { review: next } : { failed: true }),
      sourceRemoval: parent,
    });
  };
  const closeOverlay = () => {
    const task = operation.task();
    if (!overlayKind() && task?.dismissible) {
      operation.dismiss(task.id, "Impact dismissed");
      if (layout.narrow()) workspaceState.openDetail();
      queueMicrotask(() => {
        requestFocus("collection-relationships");
        focusRegistry.target("collection-relationships")?.focus();
      });
      return;
    }
    const payload = sessionPayload();
    const revision = overlaySession().revision;
    if (payload?.family === "collection-review" && !payload.review) {
      effects.cancel();
      closeSession(revision);
      return;
    }
    let dismissed = overlaySession();
    setOverlaySession((current) => {
      dismissed = reduceOverlaySession(current, {
        type: "requestDismiss",
        revision,
      });
      return dismissed;
    });
    if (dismissed.cancelRequested) {
      effects.cancel();
      return;
    }
    if (payload?.family === "installed-preview") {
      if (payload.review) effects.discardInstalledReview(payload.review);
      closeSession();
      return;
    } else if (payload?.family === "source-removal") {
      if (payload.review) effects.discardReview(payload.review);
      closeSession();
      return;
    } else if (
      payload?.family === "source-observation" ||
      payload?.family === "config-observation"
    ) {
      closeSession();
      return;
    } else if (payload?.family === "source-selection") {
      effects.discardDiscovery(payload.review);
      closeSession();
      return;
    } else if (payload?.family === "installed-rebind") {
      closeSession();
      return;
    } else if (payload?.family === "collection-review" && payload.review) {
      effects.discardCollectionReview(payload.review);
      closeSession(revision);
    } else closeSession();
  };
  const observeConfig = async (
    id: string,
    observed: ReturnType<typeof beginSession>,
  ): Promise<void> => {
    const observation = await effects.observeConfig(id);
    if (!sessionMatches(observed, "selection", "config-observation") || overlaySession().dismissed)
      return closeSession(observed.revision);
    if (!observation?.exactRevision) {
      settleSession(observed.revision, observed.requestEpoch, "review");
      return;
    }
    const preview = beginSession(observed.revision, "preview");
    const impact = await effects.previewConfig({
      kind: "adopt",
      id,
      observation,
    });
    if (
      !sessionMatches(preview, "selection", "config-observation") ||
      overlaySession().dismissed ||
      !impact
    )
      return closeSession(preview.revision);
    settleSession(preview.revision, preview.requestEpoch, "review", {
      family: "config-operation",
      kind: "adopt",
      id,
      observation,
      impact,
    });
  };
  const beginConfigObservation = (id: string) => {
    openSession("selection", { family: "config-observation", id }, "observing");
    void observeConfig(id, beginSession(overlaySession().revision, "observing"));
  };
  const beginManagedOperation = (level: "global" | "project" | "local") => {
    const config = projection.workspace()?.configs.find((item) => item.level === level);
    if (!config || config.file.status !== "valid") return;
    openSession("confirm", {
      family: "config-operation",
      kind: "managed",
      level,
      file: config.file.file,
      enabled: true,
    });
  };
  const explicitSkillDetail = () =>
    route.snapshot().destination === "workspace" &&
    route.snapshot().current.section === "skills" &&
    route.snapshot().current.surface === "inspector";
  const pageActionFacts = () => ({
    workspace: workspaceState.snapshot(),
    explicitSkillDetail: explicitSkillDetail(),
    collections: collectionsState.snapshot(),
    config: (destination: Exclude<Destination, "workspace">) => configState.snapshot(destination),
  });
  createEffect(() => {
    if (route.snapshot().destination !== "workspace" || !skillWorkspace()) return;
    const selected = installedSkillContext("workspace", projection.workspace(), {
      ...pageActionFacts(),
      explicitSkillDetail: false,
    })?.skill;
    const current = reader();
    untrack(() => {
      if (!selected) {
        readerOwner.cancelContent();
        workspaceState.closeReader();
        return;
      }
      workspaceState.openReader();
      const changed = !current?.address || !sameSkillAddress(current.address, selected.address);
      selectReaderSkill(selected.address);
      if (changed) readerOwner.patch({ tab: "skill" });
    });
  });
  const dispatchAction = async (id: ActionId, returnFocus?: FocusOwner) => {
    const workspace = projection.workspace();
    if (!workspace) return;
    const pageFacts = pageActionFacts();
    if (id === "open-palette") {
      openSession("palette", {
        family: "palette",
      });
      return;
    }
    const destination = route.snapshot().destination;
    const currentConfig =
      destination === "workspace"
        ? undefined
        : workspace.configs.find((item) => item.level === destination);
    const configMutation = new Set<ActionId>([
      "add-source",
      "add-config-source",
      "new-collection",
      "add-membership",
      "remove-membership",
      "import-collection",
      "add-reference",
      "remove-reference",
      "add-link",
      "remove-link",
      "set-collection-use",
      "remove-collection",
      "config-observe",
      "config-forget",
      "config-remove",
      "enable-managed-opencode",
      "disable-managed-opencode",
    ]);
    const descriptor = actions().find((action) => action.id === id);
    // The cold-start primary action reaches the same Source registration form before commands exist.
    const coldStartAddSource =
      id === "add-source" &&
      route.snapshot().destination === "workspace" &&
      workspaceState.section() === "skills" &&
      !workspaceState.sourceFilter() &&
      workspace.installedSkills.length === 0;
    // Stale palette IDs must not start a write flow after the selected Config becomes invalid.
    if (
      destination !== "workspace" &&
      configMutation.has(id) &&
      currentConfig?.file.status !== "valid" &&
      currentConfig?.file.status !== "missing"
    )
      return;
    if (!descriptor?.enabled && !coldStartAddSource) {
      if (descriptor?.disabledReason)
        operation.report({
          code: "INVALID_ARGUMENT",
          severity: "warning",
          message: descriptor.disabledReason,
        });
      return;
    }
    if (id === "enable-managed-opencode" || id === "disable-managed-opencode") {
      if (destination === "workspace") return;
      if (!currentConfig || currentConfig.file.status !== "valid") return;
      if (id === "enable-managed-opencode") beginManagedOperation(destination);
      else
        openSession("confirm", {
          family: "config-operation",
          kind: "managed",
          level: destination,
          file: currentConfig.file.file,
          enabled: false,
        });
      return;
    }
    if (id === "remove-source") {
      openSession("confirm", { family: "source-removal" }, "preview");
      const begun = beginSession(overlaySession().revision, "preview");
      const { revision, requestEpoch } = begun;
      const next = await effects.review(
        actionIntent(id, route.snapshot().destination, workspace, pageFacts),
      );
      if (!sessionMatches(begun, "confirm", "source-removal")) return;
      if (overlaySession().dismissed || !next) return closeSession(revision);
      settleSession(revision, requestEpoch, "review", {
        family: "source-removal",
        review: next,
      });
      return;
    }
    if (id === "new-collection") {
      const destination = route.snapshot().destination;
      openSession("form", {
        family: "collection-create",
        ...(destination === "workspace"
          ? { allowedLevels: ["global", "project", "local"] as const }
          : { level: destination }),
      });
      return;
    }
    if (id === "add-source" || id === "add-config-source") {
      const destination = route.snapshot().destination;
      openSession("form", {
        family: "source-registration",
        kind: id === "add-source" ? "source" : "config-source",
        ...(destination === "workspace" ? {} : { level: destination }),
      });
      return;
    }
    if (id === "open-config-integration") {
      const destination = configDestination();
      const owner = selectedConfigIntegrationOwner(
        workspace,
        destination,
        configState.snapshot(destination),
      );
      if (!owner || owner.level === destination) return;
      routeSource({
        destination: owner.level,
        section: "integrations",
        selection: configDeclarationOwnerKey(owner),
        handoff: { kind: "config-integration", owner },
      });
      return;
    }
    if (id === "config-observe" || id === "config-forget" || id === "config-remove") {
      const source = currentConfig?.direct.configSources.find(
        (item) =>
          item.owner.pointer === configState.selection(configDestination(), "config-sources"),
      );
      if (!source) return;
      if (id === "config-observe") {
        beginConfigObservation(source.id);
        return;
      }
      const kind = id === "config-forget" ? "forget" : "remove";
      openSession("confirm", { family: "config-operation", kind, id: source.id }, "preview");
      const begun = beginSession(overlaySession().revision, "preview");
      const impact = await effects.previewConfig({ kind, id: source.id });
      if (
        !sessionMatches(begun, "confirm", "config-operation") ||
        overlaySession().dismissed ||
        !impact
      )
        return closeSession(begun.revision);
      settleSession(begun.revision, begun.requestEpoch, "review", {
        family: "config-operation",
        kind,
        id: source.id,
        impact,
      });
      return;
    }
    if (id === "add-membership") {
      const collectionId =
        route.snapshot().destination === "workspace"
          ? collectionsState.selected()
          : configState.selection(configDestination(), "collections");
      const collection =
        workspace.effective.status === "complete"
          ? workspace.effective.collectionsView.find((item) => item.id === collectionId)
          : undefined;
      const owner =
        route.snapshot().destination === "workspace"
          ? (collection?.declared.find((item) => !item.contribution && item.level === "project") ??
            collection?.declared.find((item) => !item.contribution))
          : collection?.declared.find(
              (item) => !item.contribution && item.level === route.snapshot().destination,
            );
      if (!collection) return;
      if (!owner && collection.repository.derived) {
        openSession("form", {
          family: "collection-create",
          allowedLevels: ["global", "project", "local"],
          fixedCollection: true,
          afterCreate: {
            collection: collection.id,
            addresses: workspaceState.selectedSkills(),
          },
        });
        return;
      }
      if (!owner) return;
      openSession("form", {
        family: "membership-chooser",
        level: owner.level,
        collection: collection.id,
        expectedOwner: owner,
      });
      return;
    }
    const selectedCollection = () => {
      if (route.snapshot().destination === "workspace")
        return workspace.effective.status === "complete"
          ? workspace.effective.collectionsView
              .find((item) => item.id === collectionsState.selected())
              ?.declared.find((owner) => !owner.contribution)
          : undefined;
      return workspace.configs
        .find((item) => item.level === route.snapshot().destination)
        ?.direct.collections.find(
          (item) => item.id === configState.selection(configDestination(), "collections"),
        )?.owner;
    };
    if (
      id === "import-collection" ||
      id === "add-reference" ||
      id === "add-link" ||
      id === "remove-collection"
    ) {
      const owner = selectedCollection();
      if (!owner) return;
      const collection =
        route.snapshot().destination === "workspace"
          ? collectionsState.selected()
          : configState.selection(configDestination(), "collections");
      if (!collection) return;
      if (id === "remove-collection") {
        openSession("confirm", { family: "collection-review" });
        await previewCollection({
          kind: "collection-removal",
          level: owner.level,
          collection,
        });
        return;
      }
      openSession("form", {
        family: "collection-draft",
        draft:
          id === "import-collection"
            ? {
                kind: "collection-import",
                level: owner.level,
                from: "",
                into: collection,
              }
            : id === "add-reference"
              ? {
                  kind: "reference",
                  level: owner.level,
                  collection,
                  name: "",
                  target: "",
                  description: "",
                }
              : {
                  kind: "link-change",
                  level: owner.level,
                  collection,
                  target: "",
                  linked: true,
                },
      });
      return;
    }
    if (id === "set-collection-use") {
      const destination = route.snapshot().destination;
      const config = workspace.configs.find((item) => item.level === destination);
      if (!config || destination === "workspace") return;
      openSession("form", {
        family: "collection-draft",
        draft: {
          kind: "collection-use",
          level: destination,
          collections: config.direct.collectionUse.map((item) => item.collection),
        },
      });
      return;
    }
    if (id === "check-updates") {
      const context = selectedSourceContext(route.snapshot().destination, workspace, pageFacts);
      if (context) openUpdates({ kind: "source", source: context.source }, true);
      return;
    }
    if (id === "add-skills") {
      const intent = sourceOperationIntent(id, route.snapshot().destination, workspace, pageFacts);
      operation.clearProblem();
      openSession("selection", { family: "source-observation", intent }, "observing");
      const begun = beginSession(overlaySession().revision, "observing");
      const { revision, requestEpoch } = begun;
      const next = await effects.discover({ kind: "source-discovery", source: intent.source });
      if (!sessionMatches(begun, "selection", "source-observation")) return;
      if (next && !overlaySession().dismissed)
        settleSession(revision, requestEpoch, "review", {
          family: "source-selection",
          review: next,
          selectedPaths: [],
        });
      else if (overlaySession().dismissed) closeSession(revision);
      else settleSession(revision, requestEpoch, "review");
      return;
    }
    if (id === "view-installed-skills") {
      const destination = route.snapshot().destination;
      const source = sourceOperationIntent("add-skills", destination, workspace, pageFacts).source;
      openInstalledSkillsFromSource(
        source,
        {
          destination,
          section:
            destination === "workspace"
              ? workspaceState.section()
              : configState.section(destination),
        } as RouteTarget,
        "command:source.skills",
      );
      return;
    }
    if (id === "open-config") {
      const target = sourceRouteIntent(id, route.snapshot().destination, workspace, pageFacts);
      routeSource({
        destination: target.owner.level,
        section: "sources",
        selection: target.source,
      });
      return;
    }
    if (id === "open-config-source") {
      const target = sourceRouteIntent(id, route.snapshot().destination, workspace, pageFacts);
      routeSource({
        destination: target.contribution.configSource.level,
        section: "config-sources",
        selection: target.contribution.configSource.pointer,
      });
      return;
    }
    if (id === "skill-add-to-collection" || id === "skill-add-selected-to-collection") {
      const targets = skillCollectionTargets(
        id,
        route.snapshot().destination,
        workspace,
        pageFacts,
      );
      if (targets.reason) {
        operation.report({
          code: "INVALID_ARGUMENT",
          severity: "warning",
          message: targets.reason,
        });
        return;
      }
      const choices =
        workspace.effective.status === "complete"
          ? workspace.effective.collectionsView.flatMap((item) =>
              item.declared.some((owner) => !owner.contribution)
                ? item.declared
                    .filter((owner) => !owner.contribution)
                    .map((owner) => ({
                      collection: item.id,
                      level: owner.level,
                      owner,
                    }))
                : item.repository.derived
                  ? [{ collection: item.id }]
                  : [],
            )
          : [];
      const addresses = targets.addresses;
      if (addresses.length === 0 || choices.length === 0) {
        operation.report({
          code: "INVALID_ARGUMENT",
          severity: "warning",
          message: "No direct Collection is available for this Installed Skill",
        });
        return;
      }
      openSession("selection", {
        family: "collection-choices",
        choices,
        addresses,
      });
      return;
    }
    const skill = installedSkillContext(destination, workspace, pageFacts)?.skill;
    if (id === "skill-open-collection-use") {
      if (skill?.selectorViews.status === "complete") {
        const view = skill.selectorViews.values.find(
          (item) => (item.exposurePaths?.length ?? 0) > 0,
        );
        const exposurePath = view?.exposurePaths?.[0];
        if (view && exposurePath)
          routeRelationship({
            destination: "workspace",
            section: "collections",
            selection: exposurePath.segments[0]!.collection,
            returnFocus:
              returnFocus ??
              (overlaySession().kind === "palette"
                ? overlaySession().restoreFocus
                : physicalFocusOwner()) ??
              route.snapshot().current.focus,
            surface: "browser",
            focus: "browser",
            handoff: {
              kind: "agent-use",
              collection: exposurePath.segments[0]!.collection,
              owner: exposurePath.owner,
              exposurePath: { segments: exposurePath.segments },
            },
          });
        if (exposurePath) {
          queueMicrotask(() => {
            workspaceState.selectSkillsView("current-exposure");
            workspaceState.showWorkArea();
            for (let index = 1; index < exposurePath.segments.length; index++)
              workspaceState.expandExposurePath({
                segments: exposurePath.segments.slice(0, index),
              });
            queueMicrotask(() =>
              workspaceState.selectExposurePath(
                JSON.stringify(
                  exposurePath.segments.map((segment) => [segment.collection, segment.reference]),
                ),
              ),
            );
          });
        }
      }
      return;
    }
    if (id === "skill-uninstall") {
      if (!skill) return;
      void previewInstalled({ kind: "uninstall", address: skill.address });
      return;
    }
    if (id === "skill-rebind") {
      const sources = workspace.effective.sources
        .filter((source) => source.id !== skill?.owner.source)
        .map((source) => source.id);
      if (!skill || sources.length === 0) {
        operation.report({
          code: "SOURCE_NOT_FOUND",
          severity: "warning",
          message: "No alternative Source is available for Rebind",
        });
        return;
      }
      openSession("selection", {
        family: "installed-rebind",
        sources,
        address: skill.address,
      });
      return;
    }
    if (id === "skill-check-updates") {
      if (skill) {
        openUpdates({ kind: "skill", address: skill.address });
        void effects.submitUpdates([skill.address]);
      }
      return;
    }
    if (id === "collection-check-updates") {
      const exposure =
        workspaceState.skillsView() === "current-exposure"
          ? deriveAgentAccessTree(workspace, workspaceState.expandedExposurePaths()).rows.find(
              (row) => row.key === workspaceState.selectedExposurePath(),
            )
          : undefined;
      const collection =
        workspaceState.skillsView() === "current-exposure"
          ? exposure?.kind === "collection"
            ? exposure.collection
            : exposure?.kind === "reference"
              ? exposure.target
              : undefined
          : collectionsState.selected();
      if (collection) openUpdates({ kind: "collection", collection }, true);
      return;
    }
    if (id === "skill-open-source") {
      if (skill)
        routeSource({
          destination: "workspace",
          section: "sources",
          selection: skill.owner.source,
        });
    }
  };
  const previewCollection = async (
    intent: import("./collection-protocol").CollectionPreviewIntent,
    removedOriginKeys?: readonly string[],
  ) => {
    const source = sessionPayload();
    const kind = overlayKind();
    if (
      (kind !== "form" && kind !== "confirm") ||
      (source?.family !== "collection-draft" &&
        source?.family !== "membership-draft" &&
        source?.family !== "membership-removal-plan" &&
        source?.family !== "collection-review")
    )
      return;
    const begun = beginSession(overlaySession().revision, "preview");
    const review = await effects.previewCollection(intent);
    if (!sessionMatches(begun, kind, source.family)) return;
    if (overlaySession().dismissed) return closeSession(begun.revision);
    if (!review) {
      if (source.family === "collection-review") return closeSession(begun.revision);
      return settleSession(begun.revision, begun.requestEpoch, "review");
    }
    const next: AppOverlayPayload = { family: "collection-review", review, removedOriginKeys };
    if (source.family === "collection-review")
      settleSession(begun.revision, begun.requestEpoch, "review", next);
    else openSession("confirm", next);
  };
  const applyCollectionReview = async () => {
    const current = collectionReviewPayload()?.review;
    if (!current) return;
    const begun = beginSession(overlaySession().revision, "executing");
    const complete = await effects.confirmCollection(current);
    if (complete && sessionMatches(begun, "confirm", "collection-review")) {
      const collection =
        current.kind === "collection-import"
          ? current.intent.into
          : current.kind === "collection-use"
            ? undefined
            : current.intent.collection;
      if (collection) collectionsState.select(collection);
      if (current.kind === "membership-batch") {
        // Completing a Collection edit does not change the separate checked set.
        const keys = collectionReviewPayload()?.removedOriginKeys;
        if (keys) collectionsState.clearOrigins(current.intent.collection, keys);
      }
      closeSession();
    } else if (sessionMatches(begun, "confirm", "collection-review") && overlaySession().dismissed)
      closeSession(begun.revision);
    else settleFailedExecution(begun);
  };
  const previewMembershipRemoval = async (
    intent: Extract<CollectionRelationshipIntent, { readonly kind: "collection-direct" }>,
  ) => {
    const effective = projection.workspace()?.effective;
    const collection =
      effective?.status === "complete"
        ? effective.collectionsView.find((item) => item.id === intent.collection)
        : undefined;
    const member = collection?.members.find(
      (item) =>
        item.name === intent.name &&
        item.address.source === intent.address.source &&
        item.address.path === intent.address.path,
    );
    const path = member?.paths.find(
      (candidate) =>
        candidate.kind === "direct" &&
        candidate.collection === intent.collection &&
        candidate.owner &&
        !candidate.owner.contribution &&
        !intent.owner.contribution &&
        candidate.owner.level === intent.owner.level &&
        candidate.owner.file === intent.owner.file &&
        candidate.owner.namespace === intent.owner.namespace &&
        candidate.owner.pointer === intent.owner.pointer,
    );
    // Batch review owns the enclosing declaration; the selected origin owns the
    // member pointer. Resolve the same exact origin as checked-origin removal.
    const plan =
      collection &&
      path &&
      collectionRemovalPlan(collection, [
        {
          key: intent.name,
          name: member!.name,
          address: member!.address,
          path,
        },
      ]);
    if (!plan?.executable) {
      operation.report({
        code: "TRANSACTION_CONFLICT",
        severity: "warning",
        message:
          "The selected Membership origin is no longer a direct declaration. Refresh and inspect its owner before retrying.",
      });
      return;
    }
    const removal = plan.removals[0]!;
    openSession("confirm", { family: "collection-review" });
    await previewCollection({
      kind: "membership-batch",
      level: removal.owner.level,
      collection: intent.collection,
      expectedOwner: removal.owner,
      additions: [],
      removals: [{ name: removal.entryName, expectedAddress: removal.address }],
    });
  };
  const confirm = async () => {
    const current = sourceRemovalPayload()?.review;
    if (!current) return;
    const begun = beginSession(overlaySession().revision, "executing");
    const complete = await effects.confirm(current);
    if (
      complete &&
      overlaySession().revision === begun.revision &&
      overlaySession().requestEpoch === begun.requestEpoch
    ) {
      closeSession();
    } else if (
      overlaySession().revision === begun.revision &&
      overlaySession().requestEpoch === begun.requestEpoch &&
      overlaySession().dismissed
    )
      closeSession(begun.revision);
    else settleFailedExecution(begun);
  };
  const previewRepairInstalled = async (
    request: InstalledSkillPreviewRequest,
    sourceReview: SourceRemovalReview,
  ) => {
    openSession(
      "confirm",
      { family: "installed-preview", request, sourceRemoval: sourceReview },
      "preview",
    );
    const begun = beginSession(overlaySession().revision, "preview");
    const next = await effects.reviewInstalled(request);
    if (
      next &&
      sessionMatches(begun, "confirm", "installed-preview") &&
      !overlaySession().dismissed &&
      installedPreviewPayload()?.sourceRemoval === sourceReview
    )
      settleSession(begun.revision, begun.requestEpoch, "review", {
        ...installedPreviewPayload()!,
        review: next,
      });
    else if (sessionMatches(begun, "confirm", "installed-preview") && overlaySession().dismissed)
      closeSession(begun.revision);
    else if (sessionMatches(begun, "confirm", "installed-preview"))
      settleSession(begun.revision, begun.requestEpoch, "review", {
        family: "source-removal",
        review: sourceReview,
      });
  };
  const confirmRepairInstalled = async () => {
    const surface = installedPreviewPayload();
    const current = surface?.review;
    const sourceReview = surface?.sourceRemoval;
    if (!current || !sourceReview) return;
    const begun = beginSession(overlaySession().revision, "executing");
    const complete = await effects.confirmInstalled(current);
    if (!complete) {
      if (
        overlaySession().revision === begun.revision &&
        overlaySession().requestEpoch === begun.requestEpoch &&
        overlaySession().dismissed
      )
        closeSession(begun.revision);
      else if (
        overlaySession().revision === begun.revision &&
        overlaySession().requestEpoch === begun.requestEpoch
      )
        settleSession(begun.revision, begun.requestEpoch, "review");
      return;
    }
    if (!sessionMatches(begun, "confirm", "installed-preview")) return;
    const rereview = beginSession(begun.revision, "preview");
    const next = await effects.review(sourceReview.intent);
    if (
      next &&
      sessionMatches(rereview, "confirm", "installed-preview") &&
      !overlaySession().dismissed
    )
      settleSession(rereview.revision, rereview.requestEpoch, "review", {
        family: "source-removal",
        review: next,
      });
    else if (sessionMatches(rereview, "confirm", "installed-preview"))
      closeSession(rereview.revision);
  };
  const applySourceSelection = async () => {
    const surface = sourceSelectionPayload();
    if (!surface) return;
    const current = surface.review;
    const begun = beginSession(overlaySession().revision, "executing");
    const complete = await effects.install(current, surface.selectedPaths);
    if (
      complete &&
      overlaySession().revision === begun.revision &&
      overlaySession().requestEpoch === begun.requestEpoch
    ) {
      closeSession();
    } else if (
      overlaySession().revision === begun.revision &&
      overlaySession().requestEpoch === begun.requestEpoch &&
      overlaySession().dismissed
    )
      closeSession(begun.revision);
    else settleFailedExecution(begun);
  };
  let exitRequested = false;
  const navigationFacts = () => {
    const workspace = projection.workspace();
    const visibleReader = (
      workspaceState.skillsView() === "current-exposure"
        ? (workspace?.installedSkills ?? [])
        : filterSkills(workspace?.installedSkills ?? [], {
            query: workspaceState.query(),
            filters: workspaceState.filters(),
            source: workspaceState.sourceFilter(),
            agentStatus: workspace?.effective.agent.status,
            collectionViews:
              workspace?.effective.status === "complete"
                ? workspace.effective.collectionsView
                : undefined,
          })
    ).find((skill) => {
      const selected = workspaceState.selectedSkill();
      return !!selected && sameSkillAddress(skill.address, selected);
    });
    const collectionFilter = collectionsState.filter();
    const collectionPage =
      route.snapshot().destination === "workspace" && workspaceState.section() === "collections";
    // Local parents are selected from the active content pane, not merely open
    // somewhere in the workbench. Legacy root fallback must not close another pane.
    const localReturn = selectedReturn()?.record.id;
    return {
      destination: route.snapshot().destination,
      section:
        route.snapshot().destination === "workspace"
          ? workspaceState.section()
          : configState.section(configDestination()),
      focus: physicalOwnerFor(renderer.currentFocusedRenderable),
      tabOrder: panels.order(),
      overlay: overlayKind(),
      task: !!operation.task(),
      narrow: layout.narrow(),
      narrowLevel: workspaceState.narrowLevel(),
      workspaceShell: route.snapshot().destination === "workspace",
      canReturn: route.canReturn(),
      browserAvailable: isMounted(focusRegistry.target("browser") as Renderable | undefined),
      activeInput: renderer.currentFocusedRenderable instanceof InputRenderable,
      readerActive:
        route.snapshot().destination === "workspace" &&
        workspaceState.section() === "skills" &&
        workspaceState.readerOpen() &&
        !!visibleReader &&
        !!reader()?.address &&
        sameSkillAddress(reader()!.address!, visibleReader.address),
      readerTab: reader()?.tab ?? "skill",
      readerResourceLevel: reader()?.resourceLevel,
      readerInline: skillWorkspace() && route.snapshot().current.surface !== "reader",
      collectionFilterOpen:
        collectionPage && collectionFilter.open && localReturn === "collections.filter.back",
      collectionFilterDimension: collectionPage && !!collectionFilter.dimension,
      collectionInspectorOpen:
        collectionPage &&
        !!collectionsState.inspector() &&
        localReturn === "collection.inspector-back",
      collectionBrowserOpen:
        route.snapshot().destination === "workspace" &&
        workspaceState.section() === "skills" &&
        ["all-installed-skills", "unassigned"].includes(workspaceState.skillsView()) &&
        workspaceState.collectionBrowserOpen() &&
        localReturn === "workspace.collections.close",
      configSourceSurface:
        route.snapshot().destination !== "workspace" &&
        configState.configSourceSurface(configDestination()) === "inspector" &&
        localReturn === "config.source.back",
      configIntegrationSurface:
        route.snapshot().destination !== "workspace" &&
        configState.integrationSurface(configDestination()) !== "list" &&
        (localReturn === "config.catalog.back" || localReturn === "config.integration.back"),
    } as const;
  };
  const routeBack = () => {
    if (overlayKind() || operation.task()) return;
    const recovered = route.snapshot().stack.at(-1)?.recovery;
    if (route.snapshot().current.surface === "reader") {
      const details = reader()?.tab === "details";
      const scrollbox = renderer.root.findDescendantById(
        details ? "reader-details" : "reader-scrollbox",
      );
      if (scrollbox && "scrollTop" in scrollbox)
        readerOwner.patch(
          details
            ? { detailsScroll: Number(scrollbox.scrollTop) }
            : { scroll: Number(scrollbox.scrollTop) },
        );
    }
    if (workspaceState.diagnosticDetail()) workspaceState.closeDiagnosticDetail();
    route.back();
    setTransition(recovered ? "Previously viewed item is no longer available" : "Back");
  };
  const applyNavigation = (decision: ReturnType<typeof resolve>) => {
    if (!decision) return false;
    if (decision.kind === "events") {
      batch(() => {
        for (const event of decision.events) {
          if (event.type === "workspace.collections.close") {
            workspaceState.setCollectionBrowserOpen(false);
            workspaceState.showWorkArea();
          } else if (event.type === "route.back") {
            routeBack();
          } else if (event.type === "collections.filter.back") {
            collectionsState.chooseFilterDimension();
            setTransition("Back to filter");
          } else if (event.type === "collections.filter.close") {
            collectionsState.closeFilter();
            setTransition("Back to Browser");
          } else if (event.type === "collections.inspector.back") {
            collectionsState.closeInspector();
            requestFocus("collection-relationships");
            setTransition("Back to Relations");
          } else if (event.type === "config.surface.back") {
            configState.backConfigSourceSurface(configDestination());
            requestFocus("browser");
            setTransition("Back to Config Sources");
          } else if (event.type === "config.integration.back") {
            const destination = configDestination();
            configState.backIntegrationSurface(destination);
            route.syncCurrent({
              section: "integrations",
              object: configState.selection(destination, "integrations"),
            });
            const surface = configState.integrationSurface(destination);
            requestFocus(surface === "inspector" ? "inspector" : "browser");
            setTransition(surface === "inspector" ? "Back to Integration" : "Back to Integrations");
          } else if (event.type === "palette.open") openSession("palette", { family: "palette" });
          else if (event.type === "reader.patch") {
            if (event.value.tab) selectReaderTab(event.value.tab);
            else {
              if (event.value.resourceLevel === "list") {
                readerOwner.abandonResource();
                setTransition("Back to Resources");
              }
              readerOwner.patch(event.value);
            }
          } else if (event.type === "focus.request") {
            requestFocus(event.focus);
          } else if (event.type === "narrow.show-list") {
            workspaceState.showList();
            setTransition("Back to Browser");
          } else if (event.type === "narrow.show-work-area") {
            workspaceState.showWorkArea();
            setTransition("Back to Browser");
          }
        }
      });
    } else if (decision.effect === "exit" && !exitRequested) {
      exitRequested = true;
      props.exit();
    } else if (decision.effect === "close-surface" || decision.effect === "cancel-operation")
      closeOverlay();
    return true;
  };
  const consume = (event: { preventDefault(): void; stopPropagation(): void }) => {
    event.preventDefault();
    event.stopPropagation();
  };
  useKeyboard((event) => {
    if (event.defaultPrevented) return;
    if (layout.tooSmall()) {
      consume(event);
      return;
    }
    const key = parseNavKey(event);
    const unmodified = isPlainNavKey(key);
    const focused = renderer.currentFocusedRenderable;
    if (!unmodified && key.name === "enter" && !(focused instanceof InputRenderable)) {
      consume(event);
      return;
    }
    const facts = navigationFacts();
    const blockedSurface = !!overlayKind() || !!operation.task();
    const ctrlOnly = key.ctrl && isPlainNavKey({ ...key, ctrl: false });
    const sharedBack =
      unmodified && returnAvailable() && renderer.currentFocusedRenderable?.id === "route-back"
        ? selectedReturn()?.record
        : undefined;
    const focusedPageCommand = [...commandRegistry.mounted().values()].find(
      (command) => unmodified && command.controlId === renderer.currentFocusedRenderable?.id,
    );
    const sharedResult = dispatchKeyEvent({
      key,
      // Modal cancellation takes priority; other keys stay with its controls.
      modal: () => {
        if (!blockedSurface) return "declined";
        if (modalControls.handleKey(event, focused)) return "consumed";
        if (
          (unmodified &&
            (key.name === "escape" ||
              (key.name === "left" && !(focused instanceof InputRenderable)))) ||
          (ctrlOnly && key.char === "c")
        ) {
          closeOverlay();
          return "consumed";
        }
        if (traverseModalControls(modalControls, focused, event)) return "consumed";
        return "declined";
      },
      // Tab is pane traversal, not a way to walk every command or native widget.
      // It deliberately runs ahead of page-local modes, including inputs.
      tab: () => {
        if (blockedSurface || key.name !== "tab" || !isPlainNavKey({ ...key, shift: false }))
          return "declined";
        const owner = panels.next(focused, key.shift);
        if (owner) requestFocus(owner);
        return "consumed";
      },
      // A mounted page's local mode owns unusual traversal before shell Back.
      widget: () => {
        if (blockedSurface) return "declined";
        const result = focusRegistry.dispatchMode(focused ?? undefined, key);
        if (result !== "declined") return result;
        if (!(focused instanceof InputRenderable)) {
          const direct = [...commandRegistry.mounted().values()].find((command) =>
            matchesCommandShortcut(command.record, key),
          );
          if (direct) {
            if (!direct.record.enabled)
              return { kind: "blocked", reason: direct.record.disabledReason ?? "Unavailable" };
            executePageCommand(direct.record.id);
            return "consumed";
          }
        }
        // Native editors and list movement remain with the mounted widget.
        if (!unmodified) return "declined";
        if (
          facts.collectionFilterOpen &&
          focused?.id === "collections-filter-search" &&
          key.name === "enter"
        ) {
          requestFocus(
            facts.collectionFilterDimension
              ? "collections-filter-values"
              : "collections-filter-dimensions",
          );
          return "consumed";
        }
        return "declined";
      },
      command: blockedSurface ? undefined : (focusedPageCommand?.record ?? sharedBack),
      execute: (record) => {
        const command = commandRegistry.mounted().get(record.id);
        if (command) executePageCommand(record.id);
        else executeRouteBack(record);
      },
      route: () => {
        if (blockedSurface || (ctrlOnly && key.char === "c")) return "declined";
        if (unmodified && (key.name === "escape" || key.name === "left") && !facts.activeInput) {
          const back = selectedReturn();
          if (back) {
            executeVisibleReturn(back);
            return "consumed";
          }
        }
        return applyNavigation(resolve(facts, key)) ? "consumed" : "declined";
      },
      shell: () => {
        if (blockedSurface || !unmodified || focused instanceof InputRenderable) return "declined";
        const owner = facts.focus;
        const enter = key.name === "enter" || key.name === "right" || key.name === "down";
        if (owner === "top-nav" && enter) {
          requestFocus("local-nav");
          return "consumed";
        }
        if (
          owner === "top-nav" &&
          key.name === "up" &&
          (!(focused instanceof SelectRenderable) || focused.getSelectedIndex() === 0)
        ) {
          requestFocus("command:shell.more-actions");
          return "consumed";
        }
        if (owner === "command:shell.more-actions" && key.name === "down") {
          requestFocus("top-nav");
          return "consumed";
        }
        if (owner === "local-nav" && !(focused instanceof SelectRenderable) && enter) {
          requestFocus("browser");
          return "consumed";
        }
        return "declined";
      },
      lifecycle: () => {
        if (blockedSurface || focused instanceof InputRenderable) return "declined";
        if ((ctrlOnly && key.char === "c") || (unmodified && key.char === "q")) {
          if (!exitRequested) {
            exitRequested = true;
            props.exit();
          }
          return "consumed";
        }
        return "declined";
      },
    });
    if (sharedResult !== "declined") {
      consume(event);
    }
  });
  onMount(() => {
    resize(renderer.width, renderer.height);
    void effects.refresh().then(() => {
      const workspace = projection.workspace();
      // Do not await: browsing and focus are available as soon as the initial
      // projection arrives; cache policy determines which Sources are checked.
      if (workspace) void effects.startUpdateChecks(workspace);
    });
  });
  createEffect(() => {
    focusVersion();
    projection.workspace();
    const refreshing = projection.refresh() === "loading";
    const projected = !!projection.workspace() || !!projection.diagnostic();
    focusedControl();
    focus.revision();
    readerFocusUnblocked();
    const owner = focusOwner();
    const revision = ++focusReconciliationRevision;
    if (appliedFocusOwner !== owner) {
      appliedFocusOwner = undefined;
      appliedFocusTarget = undefined;
    }
    queueMicrotask(() => {
      if (focusReconciliationRevision !== revision) return;
      if (focus.desired() !== owner) return;
      if (overlayKind() || operation.task()) return;
      if (layout.tooSmall()) return;
      if (!owner) {
        const physical = renderer.currentFocusedRenderable;
        // Updating an input's controlled value briefly detaches it from the
        // renderer while OpenTUI reconciles the surrounding list. That is not
        // a navigation loss: restoring the route's prior browser owner here
        // steals native text focus after every keystroke.
        if (
          projected &&
          !refreshing &&
          !(physical instanceof InputRenderable) &&
          !isMounted(physical ?? undefined)
        ) {
          requestFocus(lastPhysicalOwner ?? route.snapshot().current.focus);
          recoveryFocusRevision = focus.revision();
        }
        return;
      }
      const target = focusRegistry.target(owner);
      if (!isMounted(target as Renderable | undefined)) {
        if (
          owner === "collection-tree" &&
          projected &&
          !refreshing &&
          !workspaceState.collectionBrowserOpen()
        ) {
          requestFocus("browser");
          return;
        }
        if (owner === "browser" && projected && !refreshing) {
          if (
            workspaceState.section() === "collections" &&
            renderer.root.findDescendantById("collection-browser") instanceof ScrollBoxRenderable
          )
            return;
          const effective = projection.workspace()?.effective;
          if (
            workspaceState.skillsView() === "current-exposure" &&
            effective?.status === "complete" &&
            effective.managed &&
            effective.agent.status === "available" &&
            effective.use.length
          )
            return;
          const content = panels.order("route-content");
          const fallback =
            content.find(
              (candidate) =>
                !["skills-views", "skills-query", "collections-query", "input"].includes(candidate),
            ) ??
            content.find((candidate) => candidate !== "skills-views") ??
            "local-nav";
          if (fallback && fallback !== owner) requestFocus(fallback);
        }
        return;
      }
      if (
        !target ||
        (appliedFocusOwner === owner &&
          appliedFocusTarget === target &&
          renderer.currentFocusedRenderable === target &&
          appliedFocusRevision === focus.revision() &&
          appliedFocusVersion === focusRegistry.version())
      )
        return;
      if (!focus.apply()) return;
      appliedFocusOwner = owner;
      appliedFocusTarget = target;
      appliedFocusRevision = focus.revision();
      appliedFocusVersion = focusRegistry.version();
    });
  });
  let gatedFocus: FocusOwner | undefined;
  let gatedContent: { readonly id: string; readonly routeRevision: number } | undefined;
  let restoreGatedContent = false;
  const resize = (width: number, height: number) => {
    const physical = physicalFocusOwner();
    const content = activeContent();
    const wasWide = layout.wide();
    let pane = renderer.currentFocusedRenderable;
    while (pane && !["collection-detail-pane", "source-details-pane"].includes(pane.id))
      pane = pane.parent;
    const hidesFocusedContents =
      wasWide && width < 100 && !!pane && workspaceState.narrowLevel() === "list";
    const wasTooSmall = layout.tooSmall();
    layout.resize(width, height, () => {
      if (layout.tooSmall()) {
        gatedFocus = physical ?? gatedFocus;
        if (!wasTooSmall && content && !content.isDestroyed)
          gatedContent = { id: content.id, routeRevision: route.snapshot().revision };
        return;
      }
      if (wasTooSmall && gatedFocus) {
        restoreGatedContent = !!gatedContent;
        if (!focus.desired()) requestFocus(gatedFocus);
        gatedFocus = undefined;
        return;
      }
      if (hidesFocusedContents) {
        requestFocus("browser");
        return;
      }
      const remountReader =
        !wasTooSmall &&
        route.snapshot().destination === "workspace" &&
        workspaceState.section() === "skills" &&
        physical !== undefined &&
        readerOwnsFocus(physical);
      if (remountReader && physical) requestFocus(physical);
    });
  };
  onResize(resize);
  const reconcileGatedContent = () => {
    if (!restoreGatedContent) return;
    const previous = gatedContent;
    restoreGatedContent = false;
    gatedContent = undefined;
    const visibleContent = (target: unknown): target is Renderable => {
      if (!(target instanceof Renderable) || target.isDestroyed || !target.parent) return false;
      let content = false;
      for (let node: Renderable | null = target; node; node = node.parent as Renderable | null) {
        if (!node.visible || node.isDestroyed) return false;
        content ||= node.id === "route-content";
      }
      return content;
    };
    const target =
      previous?.routeRevision === route.snapshot().revision
        ? renderer.root.findDescendantById(previous.id)
        : undefined;
    if (visibleContent(target)) {
      // A resize gate remounts native objects. Reconcile the originating content
      // before restoring chrome focus; never revive its old return token/object.
      setActiveContent(target);
      renderer.requestRender();
      return;
    }
    // The old surface disappeared: enter a real visible content region instead
    // of presenting its outer route as if it were the old local parent.
    const owner = panels
      .order("route-content")
      .find((owner) => visibleContent(focusRegistry.target(owner)));
    const fallback = owner && focusRegistry.target(owner);
    if (visibleContent(fallback)) setActiveContent(fallback);
    requestFocus(owner ?? "local-nav");
  };
  const applyPendingFocus = () => {
    if (overlayKind() || operation.task() || layout.tooSmall()) return;
    reconcileGatedContent();
    if (!focus.desired()) return;
    focus.apply();
  };
  renderer.on("frame", applyPendingFocus);
  onCleanup(() => {
    focusReconciliationRevision += 1;
    shellFocusRevision += 1;
    if (pendingShellFocus) renderer.off("frame", pendingShellFocus.listener);
    pendingShellFocus = undefined;
    routeBackBinding?.cleanup();
    renderer.off("focused_renderable", syncPhysicalFocus);
    renderer.off("frame", applyPendingFocus);
    stopThemeFollow();
    stopFocusSubscription();
    effects.teardown();
    readerOwner.dispose();
  });
  const actionDestination = createMemo(() => route.snapshot().destination);
  const actions = createMemo(() =>
    reachableActions(actionDestination(), projection.workspace(), pageActionFacts()),
  );
  const taskCommands = createMemo(() => {
    const command = (
      id: string,
      verb: string,
      destination: string,
      execute: () => void,
      reason?: string,
    ) => ({
      record: {
        id,
        verb,
        destination,
        keys: ["enter"],
        scope: "task",
        enabled: !reason,
        disabledReason: reason,
        danger: false,
      } satisfies CommandRecord,
      execute,
    });
    const records: ReturnType<typeof command>[] = [];
    const run = effects.updateRun();
    if (run) {
      const target =
        run.addresses.length === 1
          ? `${run.addresses[0]!.source}/${run.addresses[0]!.path || "."}`
          : `${run.addresses.length} Skills · ${new Set(run.addresses.map((address) => address.source)).size} Sources`;
      records.push(
        command(
          "updates.task.show",
          run.phase === "settled" ? "View update result" : "View update task",
          target,
          showUpdateTask,
        ),
      );
      if (run.phase !== "settled")
        records.push(
          command(
            "updates.task.stop",
            "Stop update",
            `${target} · completed updates remain published`,
            () => {
              effects.stopUpdates();
            },
            run.phase === "stopping" ? "Stopping; waiting for the current operation" : undefined,
          ),
        );
    }
    const check = effects.checkActivity();
    if (check) {
      records.push(
        command("checks.task.show", "View checks", check.source, () =>
          openUpdates({ kind: "workspace" }),
        ),
      );
      records.push(
        command(
          "checks.task.stop",
          "Stop checks",
          "Cancel read-only checks; updating is not cancelled",
          () => {
            effects.stopUpdateChecks();
          },
          check.phase === "stopping" ? "Stopping; waiting for the current check" : undefined,
        ),
      );
    }
    return records;
  });
  const commandRegistry = createCommandRegistry((): readonly ExecutableCommand[] => [
    ...returnCommands(),
    ...[...pageCommands().values()].flat(),
    ...taskCommands(),
    ...actions()
      .filter((record) => record.id !== "open-palette")
      .map((record) => ({
        record,
        execute: () => {
          void dispatchAction(record.id);
        },
      })),
    {
      record: {
        id: "diagnostics.logs",
        verb: "Diagnostic logs",
        keys: ["enter"],
        destination: "Inspect technical logs without interrupting updates",
        scope: "shell",
        enabled: true,
        danger: false,
      },
      execute: () =>
        openSession("help", { family: "diagnostic-log", text: renderer.console.getCachedLogs() }),
    },
    ...destinations.map((destination) => ({
      record: {
        id: `navigate.${destination}`,
        keys: ["enter"],
        verb:
          destination === "workspace"
            ? "Workspace"
            : destination[0]!.toUpperCase() + destination.slice(1),
        destination:
          destination === "workspace"
            ? "Workspace"
            : `${destination[0]!.toUpperCase() + destination.slice(1)} Config`,
        scope: "route" as const,
        enabled: true,
        danger: false,
      },
      execute: () => selectDestination(destination),
    })),
  ]);
  const executePaletteCommand = (id: string) => {
    if (!commandRegistry.resolve(id)?.record.enabled) return;
    const origin = overlaySession().restoreFocus;
    // Dismiss and restore before invoking: a command can open another dialog
    // or route, whose focus must not be overwritten by palette cleanup.
    closeSession(overlaySession().revision, false);
    if (origin) focusRegistry.applyFocus(origin);
    route.syncCurrent({ focus: physicalFocusOwner() ?? "browser" });
    commandRegistry.execute(id);
  };
  const sectionTitle = (section: Section): string =>
    section === "config-sources"
      ? "Config Sources"
      : section === "skills"
        ? "Skills"
        : section[0]!.toUpperCase() + section.slice(1);
  const readerTabLabel = (tab: import("./types").ReaderState["tab"]) =>
    tab === "skill" ? "SKILL.md" : tab === "resources" ? "Resources" : "Details";
  const routeTargetLabel = (target: Pick<RouteTarget, "destination" | "section">) =>
    target.destination === "workspace"
      ? `Workspace > ${sectionTitle(target.section)}`
      : `${target.destination[0]!.toUpperCase()}${target.destination.slice(1)} > ${sectionTitle(target.section)}`;
  const frameLabel = (frame: ReturnType<typeof route.snapshot>["current"]) => {
    const context =
      frame.context === "workspace"
        ? "Workspace"
        : `${frame.context[0]!.toUpperCase()}${frame.context.slice(1)} Config`;
    const segments = [context, sectionTitle(frame.section)];
    if (frame.surface === "reader") {
      segments.push("Reader");
      const currentReader = frame === route.snapshot().current ? reader() : frame.reader;
      if (currentReader) segments.push(readerTabLabel(currentReader.tab));
    } else if (frame.surface === "inspector") segments.push("Details");
    if (frame.surface !== "browser" && frame.object)
      segments.push(
        typeof frame.object === "string"
          ? frame.object
          : `${frame.object.source}/${frame.object.path}`,
      );
    return segments.join(" / ");
  };
  const routeBackRecord = (prior: ReturnType<typeof route.snapshot>["current"]): CommandRecord => ({
    id: "route.back",
    keys: ["enter"],
    verb: `Back to ${sectionTitle(prior.section)}${prior.surface === "inspector" ? " details" : ""}`,
    destination: frameLabel(prior),
    scope: "route",
    enabled: true,
    danger: false,
  });
  const returnAvailable = () => selectedReturn() !== undefined;
  const executeRouteBack = (record: CommandRecord) => {
    const back = selectedReturn();
    if (!back || record.id !== back.record.id || record.destination !== back.record.destination)
      return;
    executeVisibleReturn(back);
  };
  type VisibleReturn = ExecutableCommand & {
    readonly token: object | symbol | string;
    readonly local: boolean;
  };
  function selectedReturn(discovery = false): VisibleReturn | undefined {
    focusVersion();
    if (
      (overlayKind() && !(discovery && overlayKind() === "palette")) ||
      operation.task() ||
      layout.tooSmall()
    )
      return;
    const target = activeContent();
    const activeBranch = new Map<Renderable, number>();
    if (target && !target.isDestroyed && target.parent)
      for (let node: Renderable | null = target; node; node = node.parent as Renderable | null) {
        if (!node.visible || node.isDestroyed) {
          activeBranch.clear();
          break;
        }
        activeBranch.set(node, activeBranch.size);
      }
    let selected: VisibleReturn | undefined;
    let nearest = Infinity;
    for (const [token, value] of pageReturns()) {
      const anchor = value.anchor();
      // Membership in the fully validated chain also proves ancestor visibility.
      if (!anchor || anchor.isDestroyed || !anchor.parent || !anchor.visible) continue;
      const distance = activeBranch.get(anchor);
      if (distance === undefined || distance >= nearest) continue;
      nearest = distance;
      const record =
        value.record.verb === "Back"
          ? { ...value.record, verb: `Back to ${value.record.destination}` }
          : value.record;
      selected = { token, local: true, record, execute: value.execute };
    }
    if (selected) return selected;
    const inlineReader = [...activeBranch.keys()].find((node) => node.id === "reader-pane");
    if (
      inlineReader &&
      route.snapshot().destination === "workspace" &&
      skillWorkspace() &&
      route.snapshot().current.surface !== "reader" &&
      workspaceState.readerOpen()
    )
      return {
        token: inlineReader,
        local: true,
        record: {
          id: "workspace.reader-back",
          verb: "Back to Skills",
          destination: "Installed Skills browser",
          scope: "page",
          keys: ["enter"],
          enabled: true,
          danger: false,
        },
        execute: () => {
          workspaceState.showWorkArea();
          requestFocus("browser");
        },
      };
    const prior = route.snapshot().stack.at(-1);
    if (prior)
      return { token: prior, local: false, record: routeBackRecord(prior), execute: routeBack };
    if (
      route.snapshot().destination === "workspace" &&
      !layout.wide() &&
      workspaceState.narrowLevel() !== "list" &&
      (!skillWorkspace() || workspaceState.narrowLevel() === "detail")
    ) {
      const section = workspaceState.section();
      return {
        token: `workspace-list:${section}`,
        local: true,
        record: {
          id: "workspace.list-back",
          verb: `Back to ${sectionTitle(section)}`,
          destination: `${sectionTitle(section)} list`,
          scope: "page",
          keys: ["enter"],
          enabled: true,
          danger: false,
        },
        execute: () => {
          if (skillWorkspace()) workspaceState.showWorkArea();
          else workspaceState.showList();
          requestFocus("browser");
        },
      };
    }
    return undefined;
  }
  function executeVisibleReturn(back: VisibleReturn) {
    const current = selectedReturn();
    if (!current || current.token !== back.token || !back.record.enabled) return;
    back.execute();
  }
  function returnCommands(): readonly ExecutableCommand[] {
    const back = selectedReturn(true);
    const result: ExecutableCommand[] = back
      ? [{ record: back.record, execute: () => executeVisibleReturn(back) }]
      : [];
    const prior = route.snapshot().stack.at(-1);
    if (back?.local && prior)
      result.push({
        record: routeBackRecord(prior),
        execute: () => {
          if (!overlayKind() && !operation.task() && route.snapshot().stack.at(-1) === prior)
            routeBack();
        },
      });
    return result;
  }
  // Focus registration changes must not remount the button that caused them.
  const displayedReturn = createMemo(() => selectedReturn(), undefined, {
    equals: (left, right) =>
      left?.token === right?.token &&
      left?.record.id === right?.record.id &&
      left?.record.verb === right?.record.verb &&
      left?.record.destination === right?.record.destination &&
      left?.record.enabled === right?.record.enabled,
  });
  const actionsMenuRecord: CommandRecord = {
    id: "shell.more-actions",
    verb: "Ctrl+P Actions",
    destination: "Find an action for the current page",
    scope: "shell",
    keys: ["enter"],
    enabled: true,
    danger: false,
  };
  const scopeMenuRecord = (): CommandRecord => ({
    id: "shell.scope",
    verb: `${layout.width() < compactControlsBelow ? "" : "Scope: "}${topOptions().find((option) => option.value === route.snapshot().destination)!.label} ▾`,
    destination: "Choose Workspace or a configuration scope",
    scope: "shell",
    keys: ["enter"],
    enabled: true,
    danger: false,
  });
  const sectionOptions = (context = route.snapshot().destination) =>
    validSections(context).map((value) => ({
      label: sectionTitle(value),
      compactLabel:
        value === "collections"
          ? "Cols"
          : value === "config-sources"
            ? "Configs"
            : value === "integrations"
              ? "Agents"
              : sectionTitle(value),
      value,
    }));
  const processStatus = createMemo<
    | {
        readonly label: string;
        readonly compactLabel?: string;
        readonly source?: string;
        readonly warning?: boolean;
      }
    | undefined
  >(() => {
    const run = effects.updateRun();
    if (run && run.phase !== "settled")
      return {
        label:
          run.phase === "stopping"
            ? "Stopping…"
            : run.phase === "checking"
              ? "Checking"
              : "Updating",
        source: run.phase === "stopping" ? undefined : run.source,
      };
    const task = operation.task();
    if (task)
      return {
        label: task.cancellationRequested ? "Stopping…" : task.title,
        compactLabel: task.cancellationRequested ? "Stopping…" : "Working",
      };
    const check = effects.checkActivity();
    if (check)
      return {
        label:
          check.phase === "stopping"
            ? "Stopping checks"
            : check.phase === "paused"
              ? "Checks queued"
              : "Checking",
        compactLabel:
          check.phase === "stopping"
            ? "Stopping…"
            : check.phase === "paused"
              ? "Queued"
              : "Checking",
        source: check.phase === "stopping" ? undefined : check.source,
      };
    if (projection.refresh() === "loading")
      return { label: "Loading workspace", compactLabel: "Loading" };
    if (run) {
      const unresolved = run.results.filter(
        (result) => !["updated", "unchanged"].includes(result.status),
      ).length;
      if (unresolved)
        return {
          label: `${unresolved} need attention`,
          compactLabel: `Review ${unresolved}`,
          warning: true,
        };
      const updated = run.results.filter((result) => result.status === "updated").length;
      return {
        label: updated ? `Updated ${updated} Skill${updated === 1 ? "" : "s"}` : "Up to date",
        compactLabel: updated ? `Updated ${updated}` : "Current",
      };
    }
    const notice =
      operation.notice() ??
      (transition() === "Previously viewed item is no longer available" ? transition() : undefined);
    return notice ? { label: notice, warning: !!operation.problem() } : undefined;
  });
  const ActivityStatus = () => (
    <text
      id="process-status"
      height={1}
      width="100%"
      fg={processStatus()?.warning ? tokens().colors.warning : tokens().colors.mutedForeground}
      wrapMode="none"
    >
      {layout.width() < compactControlsBelow
        ? (processStatus()?.compactLabel ?? processStatus()?.label)
        : processStatus()?.label}
      {(layout.width() >= compactControlsBelow ||
        (layout.width() >= 64 && layout.width() < stackedNavigationBelow)) &&
      processStatus()?.source
        ? ` · ${processStatus()!.source}`
        : ""}
    </text>
  );
  const hintWidth = () => Math.max(1, layout.width() - 2);
  const guidance = createMemo(() => {
    focusVersion();
    const target = focusedControl();
    const owner = physicalFocusOwner();
    const command = [...commandRegistry.mounted().values()].find(
      (item) => item.controlId === target?.id,
    )?.record;
    const rowAction = owner === "collection-relationships" && target?.id.includes(":action-");
    const horizontal =
      owner === "top-nav" ||
      owner === "reader-tabs" ||
      owner === "skills-views" ||
      (owner === "local-nav" && !layout.wide());
    const palette = overlayKind() === "palette";
    const filter = overlayKind() === "filter";
    const canonical = owner ? focusRegistry.target(owner) : undefined;
    const treeTarget =
      canonical instanceof ScrollBoxRenderable &&
      ["current-exposure-browser", "collection-filter-tree", "collection-browser"].includes(
        canonical.id,
      )
        ? canonical
        : undefined;
    const treeBrowser = !!treeTarget;
    const exposureRow =
      treeTarget?.id === "current-exposure-browser"
        ? deriveAgentAccessTree(
            projection.workspace(),
            workspaceState.expandedExposurePaths(),
          ).rows.find((row) => row.key === workspaceState.selectedExposurePath())
        : undefined;
    const inventoryRows =
      treeTarget?.id === "collection-filter-tree"
        ? deriveCollectionFilterTree(
            projection.workspace(),
            workspaceState.expandedCollectionPaths(),
          ).rows
        : [];
    const collection = workspaceState.filters().Collection;
    const inventoryRow = collection
      ? (inventoryRows.find(
          (row) =>
            row.key === workspaceState.selectedCollectionPath() && row.collection === collection,
        ) ?? inventoryRows.find((row) => row.collection === collection))
      : undefined;
    const treeRow = exposureRow ?? inventoryRow;
    const treeExpanded = exposureRow
      ? workspaceState.isExposurePathExpanded(exposureRow.nodeId.path)
      : inventoryRow
        ? !!workspaceState.expandedCollectionPaths()[inventoryRow.key]
        : false;
    const filterCommand: CommandRecord | undefined =
      filter &&
      [
        "skills-filter-search",
        "skills-filter-close",
        "skills-filter-clear-all",
        "skills-filter-clear-search",
      ].includes(target?.id ?? "")
        ? {
            id: "filter.focus",
            verb:
              target?.id === "skills-filter-search"
                ? "options"
                : target?.id === "skills-filter-close"
                  ? "close"
                  : target?.id === "skills-filter-clear-search"
                    ? "clear search"
                    : "clear filters",
            keys: ["enter"],
            destination: "Filter",
            scope: "modal",
            enabled: true,
            danger: false,
          }
        : undefined;
    const useChoiceHint =
      target?.id === "collection-use-values"
        ? overlaySession().phase === "cancelling"
          ? { full: "Cancelling · selection locked", short: "Cancelling" }
          : overlaySession().phase === "preview"
            ? { full: "Reviewing · selection locked", short: "Reviewing" }
            : { full: "↑↓ Collections · Space/Enter check", short: "Space/Enter check" }
        : undefined;
    const mode: InteractionMode =
      target instanceof InputRenderable
        ? "edit"
        : palette && target?.id === "palette-command-details"
          ? "scroll"
          : palette || command || filterCommand || target?.id === "route-back"
            ? "command"
            : horizontal
              ? "horizontal"
              : target instanceof ScrollBoxRenderable && !treeBrowser
                ? "scroll"
                : "browse";
    if (rowAction)
      return keyboardGuidance({
        mode: "browse",
        width: hintWidth(),
        browseHint: {
          full: `←→ actions · Enter ${command?.verb ?? "press"} · Esc row`,
          short: "←→ actions · Esc row",
        },
      });
    return keyboardGuidance({
      mode,
      width: hintWidth(),
      command:
        filterCommand ??
        (palette
          ? target?.id === "palette-query"
            ? paletteSearchCommand
            : target?.id === "palette-close"
              ? paletteCloseCommand
              : undefined
          : target?.id === "route-back"
            ? selectedReturn()?.record
            : command),
      commands: [...commandRegistry.mounted().values()].map((item) => item.record),
      browseHint:
        useChoiceHint ??
        (filter
          ? target?.id === "skills-filter-dimensions"
            ? { full: "↑↓ dimension · Enter options", short: "Enter options" }
            : { full: "↑↓ option · Enter apply · / search", short: "Enter apply · / search" }
          : treeTarget?.id === "collection-browser"
            ? {
                full: "↑↓ Collections · ←→ level · Enter contents · / search",
                short: "Enter contents · ←→ level",
              }
            : treeBrowser
              ? exposureRow?.kind === "skill"
                ? exposureRow.availability.status === "available"
                  ? { full: "↑↓ nodes · Enter read · ← parent", short: "Enter read" }
                  : { full: "Unavailable · ↑↓ nodes · ← parent", short: "Unavailable" }
                : treeTarget?.id === "collection-filter-tree" && !collection
                  ? { full: "↑↓ nodes · Enter Skills", short: "Enter Skills" }
                  : treeRow && !treeRow.expandable
                    ? { full: "No children · ↑↓ nodes · ← parent", short: "No children" }
                    : {
                        full: `↑↓ nodes · Enter ${treeExpanded ? "collapse" : "expand"} · ←→ level`,
                        short: `Enter ${treeExpanded ? "collapse" : "expand"}`,
                      }
              : owner === "collection-relationships" &&
                  collectionsState.tab(collectionsState.selected() ?? "") === "entries"
                ? {
                    full: "Enter open · → actions · Space check origins",
                    short: "→ actions · Space check",
                  }
                : owner === "collection-relationships"
                  ? { full: "Enter manage · → actions", short: "→ actions" }
                  : skillWorkspace() && owner === "browser"
                    ? { full: "Enter read · / filter · Space check", short: "Enter read" }
                    : undefined),
      modal: !!overlayKind() || !!operation.task(),
      modalBack: filter && target?.id === "skills-filter-search" ? "options" : "close",
    });
  });
  const selectDestination = (destination: Destination) => {
    route.switchContext(destination, "top-nav");
    setTransition(
      `Opened ${destination === "workspace" ? "Workspace" : `${destination[0]!.toUpperCase()}${destination.slice(1)} Config`}`,
    );
  };
  const configDestination = () => {
    const destination = route.snapshot().destination;
    return destination === "workspace" ? "global" : destination;
  };
  const selectSection = (section: Section) => {
    cancelPendingShellFocus();
    const destination = route.snapshot().destination;
    if (destination === "workspace" && section === "updates") {
      const workspace = projection.workspace();
      if (workspace && !effects.updatesActive())
        effects.selectUpdatesScope({ kind: "workspace" }, workspace);
    }
    if (destination !== "workspace")
      configState.selectSection(destination, section as ConfigSection);
    route.switchSection(section, "local-nav");
    const routeRevision = route.snapshot().revision;
    const revision = shellFocusRevision;
    const listener = () => {
      if (pendingShellFocus?.revision !== revision) return;
      pendingShellFocus = undefined;
      const current = route.snapshot();
      if (
        current.revision !== routeRevision ||
        current.destination !== destination ||
        current.current.section !== section ||
        current.current.surface !== "browser" ||
        focus.desired() !== "local-nav"
      )
        return;
      focusRegistry.applyFocus("local-nav");
    };
    pendingShellFocus = {
      revision,
      destination,
      section,
      routeRevision,
      listener,
    };
    renderer.once("frame", listener);
  };
  const shellNavigationRecord = (
    scope: "context" | "section",
    direction: "previous" | "next",
  ): CommandRecord => {
    const values =
      scope === "context" ? destinations : validSections(route.snapshot().current.context);
    const current =
      scope === "context" ? route.snapshot().current.context : route.snapshot().current.section;
    const index = values.findIndex((value) => value === current);
    const target =
      values[
        Math.max(0, Math.min(values.length - 1, index + (direction === "previous" ? -1 : 1)))
      ]!;
    const label =
      scope === "context"
        ? target === "workspace"
          ? "Workspace"
          : `${target[0]!.toUpperCase()}${target.slice(1)} Config`
        : sectionTitle(target as Section);
    return {
      id: `${scope}.${direction}`,
      keys: [direction === "previous" ? "left" : "right"],
      verb:
        direction === "previous"
          ? `Previous ${scope === "context" ? "Context" : "Section"}`
          : `Next ${scope === "context" ? "Context" : "Section"}`,
      destination: label,
      scope: "shell",
      enabled: true,
      danger: false,
    };
  };
  const commitShellNavigation = (
    scope: "context" | "section",
    target: Destination | Section,
    record?: CommandRecord,
  ) => {
    if (!record) {
      if (scope === "context") {
        requestFocus("local-nav");
        queueMicrotask(() => {
          if (!focus.apply()) renderer.once("frame", () => focus.apply());
        });
      }
      return;
    }
    const direction = record.id === `${scope}.previous` ? "previous" : "next";
    const expected = shellNavigationRecord(scope, direction);
    if (
      record.id !== expected.id ||
      record.scope !== expected.scope ||
      record.destination !== expected.destination ||
      record.keys[0] !== expected.keys[0]
    )
      return;
    if (scope === "context") selectDestination(target as Destination);
    else selectSection(target as Section);
    setTransition(`${record.verb}: ${record.destination}`);
  };
  return (
    <Show
      when={!layout.tooSmall()}
      fallback={
        <RouteShell
          mode="too-small"
          columns={layout.width()}
          slots={{
            scopeControls: null,
            activity: null,
            back: null,
            pageNavigation: null,
            content: null,
            commandStatus: null,
          }}
        />
      }
    >
      {(_available) => (
        <ModalControlsProvider value={modalControls}>
          <PageNavigationProvider value={pageNavigation}>
            <RouteShell
              mode={layout.mode()}
              columns={layout.width()}
              slots={{
                scopeControls: () => (
                  <>
                    <box
                      width={layout.width() < compactControlsBelow ? 13 : 20}
                      height={1}
                      flexShrink={0}
                    >
                      <CommandControl
                        id="shell-scope-select"
                        record={scopeMenuRecord()}
                        keyboard={false}
                        register={(target) => {
                          const unbind = focusRegistry.register("top-nav", target);
                          const unregister = registerPageCommand(
                            { ...scopeMenuRecord(), verb: "Change Scope" },
                            "top-nav",
                            "shell-scope-select",
                            openScopeSelection,
                          );
                          return () => {
                            unbind();
                            unregister();
                          };
                        }}
                        execute={openScopeSelection}
                      />
                    </box>
                    <box width={layout.width() < 120 ? 9 : 16} height={1} flexShrink={0}>
                      <CommandControl
                        id="shell-more-actions"
                        record={
                          layout.width() < 120
                            ? { ...actionsMenuRecord, verb: "Actions" }
                            : actionsMenuRecord
                        }
                        keyboard={false}
                        register={(target) => {
                          const unregisterFocus = focusRegistry.register(
                            "command:shell.more-actions",
                            target,
                          );
                          const unregisterCommand = registerPageCommand(
                            actionsMenuRecord,
                            "command:shell.more-actions",
                            "shell-more-actions",
                            openPalette,
                          );
                          return () => {
                            unregisterFocus();
                            unregisterCommand();
                          };
                        }}
                        execute={openPalette}
                      />
                    </box>
                  </>
                ),
                activity: () => <ActivityStatus />,
                back: () => (
                  <Show when={displayedReturn()} keyed>
                    {(back) => (
                      <CommandControl
                        id="route-back"
                        record={back.record}
                        label="Back"
                        register={bindRouteBack}
                        keyboard={false}
                        execute={() => executeVisibleReturn(back)}
                      />
                    )}
                  </Show>
                ),
                pageNavigation: () => (
                  <box flexDirection="row" flexGrow={1} minWidth={0} height={1}>
                    <Show when={layout.width() >= 120}>
                      <text width={11} flexShrink={0}>
                        <strong>skill-cli</strong>
                      </text>
                    </Show>
                    <box flexGrow={1} flexBasis={0} minWidth={0} height={1}>
                      {/* Scope replaces the native tab set, never its viewport. */}
                      <Show when={route.snapshot().destination} keyed>
                        {(context) => (
                          <SectionTabs
                            id={
                              context === "workspace" ? "shell-section" : `shell-section-${context}`
                            }
                            panelId={
                              context === "workspace" ? "shell-section" : `shell-section-${context}`
                            }
                            owner="local-nav"
                            compact={layout.width() < 132}
                            options={sectionOptions(context)}
                            value={route.snapshot().current.section}
                            focusRegistry={focusRegistry}
                            commandForDirection={(direction) =>
                              shellNavigationRecord("section", direction)
                            }
                            onNavigate={(section, record) =>
                              commitShellNavigation("section", section, record)
                            }
                            onActivate={() => requestFocus("browser")}
                          />
                        )}
                      </Show>
                    </box>
                  </box>
                ),
                content: () => (
                  <>
                    {route.snapshot().destination === "workspace" ? (
                      <WorkspacePage
                        surface={route.snapshot().current.surface}
                        workspace={workspaceState}
                        collections={collectionsState}
                        reader={() =>
                          reader() ?? {
                            tab: "skill",
                            raw: false,
                            find: "",
                            match: 0,
                            scroll: 0,
                            detailsScroll: 0,
                            resources: [],
                          }
                        }
                        overlay={() => !!overlayKind()}
                        mode={layout.mode()}
                        narrowLevel={workspaceState.narrowLevel()}
                        handoff={route.snapshot().handoff}
                        projection={projection.workspace}
                        focusRegistry={focusRegistry}
                        registerCommand={registerPageCommand}
                        onRequestFocus={requestFocus}
                        executeCommand={executePageCommand}
                        actions={actions()}
                        onSkillRelationship={(relationship: string) => {
                          workspaceState.selectSkillRelationship(relationship);
                          const workspace = projection.workspace();
                          const skill = workspace?.installedSkills.find((item) =>
                            sameSkillAddress(
                              item.address,
                              workspaceState.selectedSkill() ?? {
                                source: "",
                                path: "",
                              },
                            ),
                          );
                          if (!skill) return;
                          const source = skill.source;
                          if (relationship.startsWith("selectors:")) {
                            const collection = relationship.slice("selectors:".length);
                            const selector =
                              skill.selectorViews.status === "complete"
                                ? skill.selectorViews.values.find(
                                    (value) =>
                                      value.collection === collection &&
                                      (value.exposurePaths?.length ?? 0) > 0,
                                  )
                                : undefined;
                            const exposurePath = selector?.exposurePaths?.[0];
                            if (selector && exposurePath) {
                              route.transition(
                                {
                                  destination: "workspace",
                                  section: "collections",
                                  selection: exposurePath.segments[0]!.collection,
                                  surface: "browser",
                                  focus: "browser",
                                  handoff: {
                                    kind: "agent-use",
                                    collection: exposurePath.segments[0]!.collection,
                                    owner: exposurePath.owner,
                                    exposurePath: {
                                      segments: exposurePath.segments,
                                    },
                                  },
                                },
                                () => {
                                  workspaceState.selectSkillsView("current-exposure");
                                  workspaceState.showWorkArea();
                                  for (let index = 1; index < exposurePath.segments.length; index++)
                                    workspaceState.expandExposurePath({
                                      segments: exposurePath.segments.slice(0, index),
                                    });
                                  workspaceState.selectExposurePath(
                                    JSON.stringify(
                                      exposurePath.segments.map((segment) => [
                                        segment.collection,
                                        segment.reference,
                                      ]),
                                    ),
                                  );
                                },
                              );
                            }
                            return;
                          }
                          if (relationship === "source" && source) {
                            routeSource({
                              destination: "workspace",
                              section: "sources",
                              selection: source.id,
                            });
                            workspaceState.openDetail();
                            requestFocus(sourceInspectorFocus(source));
                          } else if (relationship === "config-source" && source?.contribution) {
                            routeSource({
                              destination: source.contribution.configSource.level,
                              section: "config-sources",
                              selection: source.contribution.configSource.pointer,
                            });
                          } else if (relationship === "config" && source) {
                            const owner = workspace?.configs
                              .flatMap((config) => config.direct.sources)
                              .find((item) => item.id === source.id)?.ref.owner;
                            if (owner)
                              routeSource({
                                destination: owner.level,
                                section: "sources",
                                selection: source.id,
                              });
                          } else if (relationship.startsWith("collection:")) {
                            const collection = relationship.slice("collection:".length);
                            routeSource({
                              destination: "workspace",
                              section: "collections",
                              selection: collection,
                            });
                            collectionsState.select(collection);
                            workspaceState.selectSection("collections");
                            workspaceState.openDetail();
                            requestFocus("inspector");
                          }
                        }}
                        onSourceRelationship={(relationship: string) => {
                          const source = projection
                            .workspace()
                            ?.effective.sources.find(
                              (item) => item.id === workspaceState.selectedSource(),
                            );
                          if (!source) return;
                          if (relationship === "skills") {
                            openInstalledSkillsFromSource(
                              source.id,
                              {
                                destination: "workspace",
                                section: "sources",
                                selection: source.id,
                              },
                              "command:source.skills",
                            );
                          } else if (relationship === "config-source" && source.contribution) {
                            routeSource({
                              destination: source.contribution.configSource.level,
                              section: "config-sources",
                              selection: source.contribution.configSource.pointer,
                            });
                          } else {
                            const owner = projection
                              .workspace()
                              ?.configs.flatMap((config) => config.direct.sources)
                              .find((item) => item.id === source.id)?.ref.owner;
                            if (owner)
                              routeSource({
                                destination: owner.level,
                                section: "sources",
                                selection: source.id,
                              });
                          }
                        }}
                        onOpenSourceSkills={(source) =>
                          openInstalledSkillsFromSource(
                            source,
                            { destination: "workspace", section: "sources", selection: source },
                            "browser",
                            "browser",
                          )
                        }
                        onSourceBrowseView={(source, patch) =>
                          workspaceState.patchSourceBrowseView(source, patch)
                        }
                        onSelectSourceRelationship={(relationship, scroll) => {
                          workspaceState.selectSourceRelationship(relationship);
                          workspaceState.setScroll("source-relationships", scroll);
                        }}
                        onSelectSource={(source) => {
                          if (!overlayKind()) workspaceState.selectSource(source);
                        }}
                        onSkill={(address, intent) => {
                          if (!skillWorkspace() && intent === "open") {
                            route.syncCurrent({
                              object: workspaceState.selectedSource(),
                              focus: physicalFocusOwner() ?? "browser",
                            });
                            openReaderSkill(address, "skill");
                            return;
                          }
                          const changed =
                            !reader()?.address || !sameSkillAddress(reader()!.address!, address);
                          workspaceState.selectSkill(address);
                          selectReaderSkill(address);
                          if (changed) readerOwner.patch({ tab: "skill" });
                          workspaceState.openReader();
                          route.syncCurrent({ object: address });
                          if (intent === "open") requestFocus("reader");
                        }}
                        onToggleSkill={(address) => {
                          workspaceState.toggleSkill(address);
                        }}
                        updates={effects.updates}
                        updatesActive={effects.updatesActive}
                        updatesRun={effects.updateRun}
                        updatesCheckingActive={effects.checkingActive}
                        updatesCurrentCheckSource={effects.currentCheckSource}
                        updatesCheckWarning={effects.updateChecksWarning}
                        sourceUpdates={activeSourceUpdatesView}
                        onSourceUpdatesQuery={workspaceState.setSourceUpdatesQuery}
                        onSourceUpdatesFilter={workspaceState.setSourceUpdatesFilter}
                        onUpdatesCheck={(sources) => void effects.checkUpdates(sources)}
                        onUpdatesSubmit={(addresses) => void effects.submitUpdates(addresses)}
                        onUpdatesOpenSource={openSourceUpdates}
                        onUpdateSource={(source) => {
                          const workspace = projection.workspace();
                          if (!workspace || effects.updatesActive()) return;
                          const state = effects.selectUpdatesScope(
                            { kind: "source", source },
                            workspace,
                          );
                          if (state) void effects.submitUpdates(state.scope.addresses);
                        }}
                        onUpdatesStop={() => effects.stopUpdates()}
                        onUpdatesStopChecking={() => effects.stopUpdateChecks()}
                        onUpdatesRetry={() => {
                          void effects.continueUpdates();
                        }}
                        onOpenSourceUpdates={(source) => openSourceUpdates(source)}
                        onSourceUpdatesDetails={(source) => {
                          const binding = projection
                            .workspace()
                            ?.effective.sources.find((item) => item.id === source);
                          if (!binding) return;
                          route.syncCurrent({ surface: "browser", focus: "browser" });
                          route.transition(
                            {
                              destination: "workspace",
                              section: "sources",
                              selection: source,
                              surface: "inspector",
                              focus: sourceInspectorFocus(binding),
                            },
                            () => {
                              workspaceState.land("sources", source);
                              workspaceState.selectSource(source);
                              workspaceState.clearSourceUpdatesView();
                              workspaceState.patchSourceBrowseView(source, { detailsOpen: true });
                              workspaceState.openDetail();
                            },
                          );
                        }}
                        onUpdatesOpenSkill={(address, tab) =>
                          openReaderSkill(address, tab ?? "skill")
                        }
                        previewUpdate={(request, options) =>
                          props.core.management.previewUpdate(request, options)
                        }
                        onFirstSkill={() => void dispatchAction("add-source")}
                        onDetail={() => {
                          if (workspaceState.section() === "sources") {
                            const source = workspaceState.selectedSource();
                            if (!source) return;
                            route.syncCurrent({
                              object: source,
                              surface: "browser",
                              region: "content",
                              focus: "browser",
                            });
                            route.transition(
                              {
                                destination: "workspace",
                                section: "sources",
                                selection: source,
                                surface: "inspector",
                                focus: sourceInspectorFocus(
                                  projection
                                    .workspace()!
                                    .effective.sources.find((item) => item.id === source)!,
                                ),
                              },
                              () => workspaceState.openDetail(),
                            );
                            return;
                          }
                          const value = reader();
                          workspaceState.openDetail();
                          requestFocus(
                            value?.tab === "resources"
                              ? value.resourceLevel === "content"
                                ? "reader-resource-content"
                                : "reader-resource-list"
                              : value?.tab === "details" &&
                                  (value.focus === "inspector" ||
                                    value.focus === "details-relationships")
                                ? value.focus
                                : "reader",
                          );
                        }}
                        onWorkspaceScroll={(surface, scroll) =>
                          workspaceState.setScroll(surface, scroll)
                        }
                        onCaptureWorkspaceScroll={(surface) => {
                          const target = focusRegistry.target("browser") as Renderable | undefined;
                          const scroll =
                            target instanceof SelectRenderable
                              ? selectScrollOffset(target)
                              : target && "scrollTop" in target
                                ? Number(target.scrollTop)
                                : undefined;
                          if (scroll !== undefined) workspaceState.setScroll(surface, scroll);
                        }}
                        onCollectionScroll={(surface, scroll) =>
                          collectionsState.setScroll(surface, scroll)
                        }
                        onSkillsView={(view) => {
                          const sameView = workspaceState.skillsView() === view;
                          const currentRoute = route.snapshot().current;
                          if (
                            currentRoute.context === "workspace" &&
                            currentRoute.section === "skills" &&
                            (currentRoute.surface === "reader" ||
                              currentRoute.surface === "inspector")
                          ) {
                            route.syncCurrent({
                              section: "skills",
                              surface: currentRoute.surface,
                              focus: "skills-views",
                            });
                            route.transition(
                              {
                                destination: "workspace",
                                section: "skills",
                                surface: "browser",
                                focus: sameView ? "browser" : "skills-views",
                              },
                              () => {
                                batch(() => {
                                  workspaceState.selectSkillsView(view);
                                  workspaceState.showList();
                                  collectionsState.closeInspector();
                                });
                              },
                            );
                            return;
                          }
                          batch(() => {
                            workspaceState.selectSkillsView(view);
                            // Compact inline reading changes layout, not route
                            // identity. Its view switch must still run locally
                            // after a resize, without manufacturing history.
                            if (
                              currentRoute.context === "workspace" &&
                              currentRoute.section === "skills" &&
                              workspaceState.narrowLevel() === "detail"
                            ) {
                              workspaceState.showWorkArea();
                              collectionsState.closeInspector();
                            }
                          });
                          route.syncCurrent({
                            section: workspaceState.section(),
                          });
                          if (sameView) requestFocus("browser");
                        }}
                        onSelectExposurePath={(path) => {
                          const row = deriveAgentAccessTree(
                            projection.workspace(),
                            workspaceState.expandedExposurePaths(),
                          ).rows.find((candidate) => candidate.key === path);
                          batch(() => {
                            workspaceState.selectExposurePath(path);
                            workspaceState.selectSkill(
                              row?.kind === "skill" && row.availability.status === "available"
                                ? row.address
                                : undefined,
                            );
                            if (row && row.kind !== "skill")
                              collectionsState.select(
                                row.kind === "reference" ? row.target : row.collection,
                              );
                          });
                        }}
                        onSelectCollectionPath={(path) => workspaceState.selectCollectionPath(path)}
                        onCollectionBrowserOpen={(open) => {
                          batch(() => {
                            workspaceState.setCollectionBrowserOpen(open);
                            workspaceState.showWorkArea();
                          });
                          requestFocus(open ? "collection-tree" : "browser");
                        }}
                        onCollectionPathExpanded={(path, expanded) =>
                          workspaceState.setCollectionPathExpanded(path, expanded)
                        }
                        onToggleExposurePath={(path) => workspaceState.toggleExposurePath(path)}
                        onExposureUpdate={(row) => {
                          const entry =
                            row.kind === "skill"
                              ? { kind: "skill" as const, address: row.address }
                              : {
                                  kind: "collection" as const,
                                  collection:
                                    row.kind === "collection" ? row.collection : row.target,
                                };
                          openUpdates(entry, true);
                        }}
                        onRepairCurrentExposure={(level, section, collection) => {
                          // Preserve the mounted repair control as the route-back focus before navigation.
                          requestFocus("work-area");
                          focusRegistry.target("work-area")?.focus();
                          routeSource({
                            destination: level,
                            section,
                            ...(collection ? { selection: collection } : {}),
                            ...(!collection && section === "collections"
                              ? { focus: "command:new-collection" as const }
                              : {}),
                          });
                        }}
                        onEnableManagedOpenCode={beginManagedOperation}
                        onClearSourceFilter={() => {
                          if (route.canReturn()) routeBack();
                          else {
                            route.switchSection("sources", "browser");
                            workspaceState.clearSourceFilter();
                            workspaceState.showWorkArea();
                            requestFocus("browser");
                          }
                        }}
                        onSkillFilter={(dimension, value) => {
                          workspaceState.setFilter(dimension, value);
                          reconcileWorkspaceSelection();
                        }}
                        onQuery={(query) => {
                          workspaceState.setQuery(query);
                          reconcileWorkspaceSelection();
                        }}
                        onOpenFilter={() => openSession("filter", { family: "skills-filter" })}
                        onClearFilter={(dimension) => {
                          workspaceState.setFilter(dimension, undefined);
                          reconcileWorkspaceSelection();
                          requestFocus("command:skills-filter.open");
                        }}
                        onClearAllFilters={() => {
                          workspaceState.clearFilters();
                          reconcileWorkspaceSelection();
                          requestFocus("browser");
                        }}
                        onSelectCollection={(collection) => {
                          if (collectionsState.selected() !== collection)
                            collectionsState.closeInspector();
                          collectionsState.select(collection);
                          route.syncCurrent({ object: collection });
                        }}
                        onCollectionQuery={(query) => {
                          collectionsState.setQuery(query);
                          reconcileCollectionSelection();
                        }}
                        onCollectionFilter={(dimension, value) => {
                          collectionsState.setFilter(dimension, value);
                          reconcileCollectionSelection();
                        }}
                        onClearCollectionFilter={(dimension) => {
                          collectionsState.clearFilter(dimension);
                          reconcileCollectionSelection();
                          requestFocus("browser");
                        }}
                        onClearAllCollectionFilters={() => {
                          collectionsState.clearFilters();
                          reconcileCollectionSelection();
                          requestFocus("browser");
                        }}
                        onCollectionFilterOpen={() => {
                          collectionsState.openFilter();
                          requestFocus("collections-filter-search");
                        }}
                        onCollectionFilterDimension={(dimension) => {
                          collectionsState.chooseFilterDimension(dimension);
                          requestFocus("collections-filter-search");
                        }}
                        onCollectionFilterSearch={(value) => {
                          collectionsState.searchFilter(value);
                        }}
                        onCollectionFilterClose={() => {
                          collectionsState.closeFilter();
                          requestFocus("browser");
                        }}
                        onCollectionTab={(collection, tab) => {
                          collectionsState.selectTab(collection, tab);
                        }}
                        onCollectionDetail={(selected) => {
                          const collection = selected ?? collectionsState.selected();
                          if (!collection) return;
                          const inCollections = workspaceState.section() === "collections";
                          collectionsState.select(collection);
                          collectionsState.closeInspector();
                          if (layout.wide() && inCollections) {
                            requestFocus("collection-relationships");
                            return;
                          }
                          route.syncCurrent({
                            section: workspaceState.section(),
                            ...(inCollections ? { object: collection } : {}),
                            surface: "browser",
                            focus: inCollections
                              ? "browser"
                              : (physicalFocusOwner() ?? route.snapshot().current.focus),
                          });
                          route.transition(
                            {
                              destination: "workspace",
                              section: "collections",
                              selection: collection,
                              surface: layout.wide() ? "browser" : "inspector",
                              focus: "collection-relationships",
                            },
                            () => {
                              collectionsState.select(collection);
                              workspaceState.selectSection("collections");
                              if (layout.wide()) workspaceState.showList();
                              else workspaceState.openDetail();
                            },
                          );
                        }}
                        onCollectionRelationship={(intent: CollectionRelationshipIntent) => {
                          if (intent.kind === "collection-info") {
                            collectionsState.openCollectionInfo(intent.collection);
                            requestFocus("inspector");
                            return;
                          }
                          if (intent.kind === "collection-membership-inspect") {
                            collectionsState.openMembership(intent.collection, intent.member);
                            requestFocus("inspector");
                            return;
                          }
                          if (intent.kind === "collection-relation-inspect") {
                            collectionsState.openRelation(intent.collection, intent.relation);
                            requestFocus("inspector");
                            return;
                          }
                          if (intent.kind === "collection-inspector-back") {
                            applyNavigation({
                              kind: "events",
                              events: [{ type: "collections.inspector.back" }],
                            });
                            return;
                          }
                          if (intent.kind === "collection-back") {
                            applyNavigation(resolveEscape(navigationFacts()));
                            return;
                          }
                          if (intent.kind === "collection-open-skill") {
                            openReaderSkill(intent.address, "skill");
                            return;
                          }
                          if (intent.kind === "collection-open-collection") {
                            const workspace = projection.workspace();
                            if (
                              workspace?.effective.status !== "complete" ||
                              !workspace.effective.collectionsView.some(
                                (collection) => collection.id === intent.target,
                              )
                            )
                              return;
                            route.syncCurrent({
                              object: intent.collection,
                              focus: physicalFocusOwner() ?? "collection-relationships",
                            });
                            route.transition(
                              {
                                destination: "workspace",
                                section: "collections",
                                selection: intent.target,
                                surface: layout.wide() ? "browser" : "inspector",
                                focus: "collection-relationships",
                              },
                              () => {
                                collectionsState.select(intent.target);
                                collectionsState.clearFilters();
                                collectionsState.closeInspector();
                                workspaceState.selectSection("collections");
                                if (layout.wide()) workspaceState.showList();
                                else workspaceState.openDetail();
                              },
                            );
                            return;
                          }
                          if (intent.kind === "collection-open-config") {
                            if (intent.owner.contribution) {
                              routeSource({
                                destination: intent.owner.contribution.configSource.level,
                                section: "config-sources",
                                selection: intent.owner.contribution.configSource.pointer,
                                handoff:
                                  intent.relationship === "reference" &&
                                  intent.name &&
                                  intent.target
                                    ? {
                                        kind: "collection-reference",
                                        collection: intent.collection,
                                        name: intent.name,
                                        target: intent.target,
                                        description: intent.description ?? "",
                                        owner: intent.owner,
                                      }
                                    : intent.relationship === "link" && intent.target
                                      ? {
                                          kind: "agent-link",
                                          collection: intent.collection,
                                          linkedCollection: intent.target,
                                          owner: intent.owner,
                                        }
                                      : {
                                          kind: "agent-use",
                                          collection: intent.collection,
                                          owner: intent.owner,
                                        },
                              });
                              return;
                            }
                            routeSource({
                              destination: intent.owner.level,
                              section: "collections",
                              selection: intent.collection,
                            });
                            return;
                          }
                          if (intent.kind === "collection-open-link") {
                            routeSource({
                              destination: intent.owner.level,
                              section: "collections",
                              selection: intent.collection,
                              handoff: {
                                kind: "agent-link",
                                collection: intent.collection,
                                linkedCollection: intent.target,
                                owner: intent.owner,
                              },
                            });
                            return;
                          }
                          if (intent.kind === "collection-use") {
                            if (intent.owner.contribution) {
                              routeSource({
                                destination: intent.owner.contribution.configSource.level,
                                section: "config-sources",
                                selection: intent.owner.contribution.configSource.pointer,
                                handoff: {
                                  kind: "agent-use",
                                  collection: intent.collection,
                                  owner: intent.owner,
                                },
                              });
                              return;
                            }
                            routeSource({
                              destination: intent.owner.level,
                              section: "collections",
                              selection: intent.collection,
                              handoff: {
                                kind: "agent-use",
                                collection: intent.collection,
                                owner: intent.owner,
                              },
                            });
                            return;
                          }
                          if (intent.kind === "collection-use-edit") {
                            const config = projection
                              .workspace()
                              ?.configs.find((item) => item.level === intent.owner.level);
                            if (config)
                              openSession("form", {
                                family: "collection-draft",
                                draft: {
                                  kind: "collection-use",
                                  level: intent.owner.level,
                                  collections: config.direct.collectionUse.map(
                                    (item) => item.collection,
                                  ),
                                },
                              });
                            return;
                          }
                          if (intent.kind === "collection-producer") {
                            batch(() => {
                              routeSource({
                                destination: "workspace",
                                section: "sources",
                                selection: intent.address.source,
                                handoff: {
                                  kind: "agent-producer",
                                  address: intent.address,
                                },
                              });
                              workspaceState.openDetail();
                            });
                            requestFocus("inspector");
                            return;
                          }
                          if (intent.kind === "collection-direct") {
                            void previewMembershipRemoval(intent);
                            return;
                          }
                          if (
                            intent.kind === "collection-reference" &&
                            !intent.owner.contribution
                          ) {
                            openSession("form", {
                              family: "collection-draft",
                              draft: {
                                kind: "reference",
                                level: intent.owner.level,
                                collection: intent.collection,
                                name: intent.name,
                                target: intent.target,
                                description: intent.description,
                                remove: true,
                              },
                            });
                            return;
                          }
                          if (intent.kind === "collection-link" && !intent.owner.contribution) {
                            openSession("form", {
                              family: "collection-draft",
                              draft: {
                                kind: "link-change",
                                level: intent.owner.level,
                                collection: intent.collection,
                                target: intent.target,
                                linked: false,
                              },
                            });
                            return;
                          }
                          const handoff =
                            intent.kind === "collection-reference"
                              ? {
                                  kind: "collection-reference" as const,
                                  collection: intent.collection,
                                  name: intent.name,
                                  target: intent.target,
                                  description: intent.description,
                                  owner: intent.owner,
                                }
                              : intent.kind === "collection-link"
                                ? {
                                    kind: "agent-link" as const,
                                    collection: intent.collection,
                                    linkedCollection: intent.target,
                                    owner: intent.owner,
                                  }
                                : {
                                    kind: "agent-membership" as const,
                                    collection: intent.collection,
                                    owner: intent.owner,
                                  };
                          routeSource({
                            destination: intent.owner.level,
                            section: intent.owner.contribution ? "config-sources" : "collections",
                            selection: intent.owner.contribution
                              ? intent.owner.contribution.configSource.pointer
                              : intent.collection,
                            handoff,
                          });
                        }}
                        onToggleCollectionOrigin={(collection, key) =>
                          collectionsState.toggleOrigin(collection, key)
                        }
                        onToggleCollectionOrigins={(collection, keys) =>
                          collectionsState.toggleOrigins(collection, keys)
                        }
                        onRemoveCollectionOrigins={(
                          collection: string,
                          rows: readonly CollectionRemovalRow[],
                        ) => {
                          const view = projection.workspace()?.effective;
                          const collectionView =
                            view?.status === "complete"
                              ? view.collectionsView.find((item) => item.id === collection)
                              : undefined;
                          if (!collectionView) return;
                          const plan = collectionRemovalPlan(collectionView, rows);
                          if (plan.ownerGroups.length > 1) {
                            operation.start({
                              id: "membership-impact-task",
                              title: "Membership impact requires multiple owners",
                              cancellationRequested: false,
                              dismissible: true,
                              semanticOwner: {
                                kind: "collection",
                                id: collection,
                              },
                              details: [
                                `Collection: ${collection}`,
                                ...plan.ownerGroups.map(
                                  (group) =>
                                    `Owner: ${group.owner.level} ${group.owner.file} ${group.owner.pointer}`,
                                ),
                                ...rows.map(
                                  (row) =>
                                    `Selected: ${row.name} ${row.address.source}/${row.address.path}`,
                                ),
                                ...plan.explanations,
                                "No changes were applied",
                              ],
                            });
                            if (layout.narrow()) workspaceState.openTask();
                            queueMicrotask(() =>
                              renderer.root.findDescendantById("membership-impact-task")?.focus(),
                            );
                            return;
                          }
                          openSession("form", {
                            family: "membership-removal-plan",
                            plan,
                          });
                        }}
                        onProblem={(intent, key) => {
                          if (intent.kind === "installed-skill") {
                            workspaceState.selectProblem(key);
                            openReaderSkill(intent.address, "skill");
                            return;
                          }
                          if (intent.kind === "diagnostic-detail") {
                            batch(() => {
                              workspaceState.selectProblem(key);
                              workspaceState.openDiagnosticDetail(key);
                            });
                            route.push({
                              destination: "workspace",
                              section: "skills",
                              surface: "inspector",
                              focus: "browser",
                            });
                            return;
                          }
                          workspaceState.selectProblem(key);
                          routeSource({
                            destination: intent.destination,
                            section: intent.section,
                            ...(intent.selection ? { selection: intent.selection } : {}),
                          });
                        }}
                        onSelectProblem={(key) => workspaceState.selectProblem(key)}
                        onInspectorFocus={() => requestFocus("inspector")}
                        onReaderPatch={(reader) => {
                          if (reader.raw !== undefined) requestFocus("command:reader.raw");
                          if (reader.tab) selectReaderTab(reader.tab);
                          else readerOwner.patch(reader);
                        }}
                        onReaderFindCommit={(value) => {
                          const current = reader();
                          readerOwner.patch({
                            find: value,
                            match: current?.find === value ? current.match : 0,
                          });
                        }}
                        onResources={() => ensureResources()}
                        onRetryContent={(address) => void readerOwner.load(address)}
                        onReloadContent={(address) => {
                          readerOwner.cancelContent();
                          readerOwner.invalidate(address);
                        }}
                        onReadResource={(address, path) => {
                          requestFocus("reader-resource-content");
                          const current = reader();
                          if (current?.resource?.path === path && !current.resourceLoading) {
                            readerOwner.patch({
                              selectedResource: path,
                              resourceLevel: "content",
                              error: undefined,
                            });
                          } else void readerOwner.read(address, path);
                        }}
                        onRetryResource={(address) => {
                          const current = reader();
                          if (current?.resourceLevel === "content" && current.selectedResource) {
                            requestFocus("reader-resource-content");
                            void readerOwner.read(address, current.selectedResource);
                          } else {
                            requestFocus(
                              current?.resources.length ? "reader-resource-list" : "reader",
                            );
                            void readerOwner.list(address);
                          }
                        }}
                        onResourceBack={() =>
                          applyNavigation({
                            kind: "events",
                            events: [
                              {
                                type: "reader.patch",
                                value: {
                                  resourceLevel: "list",
                                  resourceLoading: false,
                                  error: undefined,
                                },
                              },
                              {
                                type: "focus.request",
                                focus: "reader-resource-list",
                              },
                            ],
                          })
                        }
                        onDetailsAction={(id) => {
                          if (!overlayKind()) void dispatchAction(id);
                        }}
                        onDetailsRelationship={(relationship) => {
                          const workspace = projection.workspace();
                          const skill = installedSkillContext(
                            route.snapshot().destination,
                            workspace,
                            pageActionFacts(),
                          )?.skill;
                          if (!skill?.source) return;
                          if (relationship === "source") {
                            const owner = workspace?.configs
                              .flatMap((config) => config.direct.sources)
                              .find((source) => source.id === skill.owner.source)?.ref.owner;
                            const handoff = skill.source.contribution
                              ? {
                                  kind: "source-contribution" as const,
                                  source: skill.source,
                                  owner: skill.source.contribution.configSource,
                                }
                              : owner
                                ? {
                                    kind: "source-declaration" as const,
                                    source: skill.source,
                                    owner,
                                  }
                                : undefined;
                            if (handoff)
                              routeRelationship({
                                destination: "workspace",
                                section: "sources",
                                selection: skill.owner.source,
                                focus: sourceInspectorFocus(skill.source),
                                returnFocus: `command:reader.relationship.${relationship}`,
                                handoff,
                              });
                          } else if (relationship === "config") {
                            const owner = workspace?.configs
                              .flatMap((config) => config.direct.sources)
                              .find((source) => source.id === skill.owner.source)?.ref.owner;
                            if (owner)
                              routeRelationship({
                                destination: owner.level,
                                section: "sources",
                                selection: skill.owner.source,
                                returnFocus: `command:reader.relationship.${relationship}`,
                                handoff: {
                                  kind: "source-declaration",
                                  source: skill.source!,
                                  owner,
                                },
                              });
                          } else if (relationship === "config-source" && skill.source.contribution)
                            routeRelationship({
                              destination: skill.source!.contribution!.configSource.level,
                              section: "config-sources",
                              selection: skill.source!.contribution!.configSource.pointer,
                              returnFocus: `command:reader.relationship.${relationship}`,
                              handoff: {
                                kind: "source-contribution",
                                source: skill.source!,
                                owner: skill.source!.contribution!.configSource,
                              },
                            });
                          else if (relationship.startsWith("collection:")) {
                            const collection = relationship.slice("collection:".length);
                            const direct = skill.collections
                              .find((item) => item.id === collection)
                              ?.paths.find((path) => path.kind === "direct");
                            const owner = direct?.kind === "direct" ? direct.owner : undefined;
                            if (owner)
                              routeRelationship({
                                destination: owner.contribution
                                  ? owner.contribution.configSource.level
                                  : owner.level,
                                section: owner.contribution ? "config-sources" : "collections",
                                selection: owner.contribution
                                  ? owner.contribution.configSource.pointer
                                  : collection,
                                returnFocus: `command:reader.relationship.${relationship}`,
                              });
                          } else if (relationship === "selectors")
                            void dispatchAction(
                              "skill-open-collection-use",
                              "command:reader.relationship.selectors",
                            );
                        }}
                        onDetailsScroll={(scroll) => readerOwner.patch({ detailsScroll: scroll })}
                      />
                    ) : (
                      <ConfigPage
                        config={configState}
                        overlay={() => !!overlayKind()}
                        mode={layout.mode()}
                        registerCommand={registerPageCommand}
                        executeCommand={executePageCommand}
                        handoff={route.snapshot().handoff}
                        projection={projection.workspace}
                        focusRegistry={focusRegistry}
                        destination={configDestination()}
                        actions={actions()}
                        onSelect={(source) => configState.select(configDestination(), source)}
                        onAction={(id) => void dispatchAction(id)}
                        onOpenConfigSourceInspector={() => {
                          configState.openConfigSourceInspector(configDestination());
                          requestFocus("inspector");
                        }}
                        onBackConfigSourceInspector={() =>
                          applyNavigation({
                            kind: "events",
                            events: [{ type: "config.surface.back" }],
                          })
                        }
                        onBackIntegrationSurface={() =>
                          applyNavigation({
                            kind: "events",
                            events: [{ type: "config.integration.back" }],
                          })
                        }
                        onIntegrationOwner={(owner) => {
                          routeSource({
                            destination: owner.level,
                            section: "integrations",
                            selection: configDeclarationOwnerKey(owner),
                            handoff: { kind: "config-integration", owner },
                          });
                        }}
                        onCollectionOwner={(collection, owner) => {
                          const target = owner.contribution?.configSource ?? owner;
                          routeSource({
                            destination: target.level,
                            section: "collections",
                            selection: collection,
                            handoff: { kind: "agent-use", collection, owner },
                          });
                        }}
                        onContribution={(contribution) => {
                          if (contribution.kind === "source")
                            route.contribution({
                              destination: contribution.owner.level,
                              section: "sources",
                              selection: contribution.source.id,
                              handoff: {
                                kind: "source-contribution",
                                source: contribution.source,
                                owner: contribution.owner,
                              },
                            });
                          else
                            route.contribution({
                              destination: contribution.owner.level,
                              section: "collections",
                              selection: contribution.collection,
                            });
                        }}
                      />
                    )}
                  </>
                ),
                commandStatus: () => (
                  <box height={1} width="100%" minWidth={0} flexDirection="row">
                    <box
                      height={1}
                      flexGrow={1}
                      minWidth={0}
                      flexDirection="row"
                      columnGap={guidance().local ? 3 : 0}
                    >
                      <text
                        id="interaction-guidance"
                        height={1}
                        width={Bun.stringWidth(guidance().local)}
                        flexShrink={0}
                        fg={tokens().colors.foreground}
                        wrapMode="none"
                      >
                        {guidance().local}
                      </text>
                      <text
                        id="navigation-guidance"
                        height={1}
                        flexGrow={1}
                        minWidth={0}
                        fg={tokens().colors.mutedForeground}
                        wrapMode="none"
                      >
                        {guidance().global}
                      </text>
                    </box>
                  </box>
                ),
              }}
            />
            <Show when={operation.task()?.dismissible ? operation.task() : undefined} keyed>
              {(task) => (
                <box
                  id={task.id}
                  position="absolute"
                  top={0}
                  left={0}
                  width="100%"
                  height="100%"
                  zIndex={3}
                  backgroundColor={tokens().colors.surface}
                  flexDirection="column"
                  padding={1}
                >
                  <text fg={tokens().colors.foreground} flexShrink={0}>
                    {task.title}
                  </text>
                  <scrollbox id="impact-details" flexGrow={1} minHeight={0}>
                    {(task.details ?? []).map((line) => (
                      <text wrapMode="word" fg={tokens().colors.foreground}>
                        {line}
                      </text>
                    ))}
                  </scrollbox>
                  <ModalCommand
                    id="impact-close"
                    record={{
                      id: "impact.close",
                      keys: ["enter"],
                      verb: "Close impact",
                      destination: "Collection entries",
                      scope: "modal",
                      enabled: true,
                      danger: false,
                    }}
                    initialFocus
                    execute={closeOverlay}
                  />
                </box>
              )}
            </Show>
            <CommandPalette
              open={overlayKind() === "palette"}
              actions={commandRegistry.records()}
              onSelect={(record) => executePaletteCommand(record.id)}
              onClose={closeOverlay}
            />
            <Dialog
              open={sessionPayload()?.family === "scope-selection"}
              onOpenChange={(open) => {
                if (!open && sessionPayload()?.family === "scope-selection") closeOverlay();
              }}
            >
              <Show when={sessionPayload()?.family === "scope-selection"}>
                <DialogContent
                  id="scope-popup"
                  anchor={() => renderer.root.findDescendantById("shell-scope-select")}
                  width={Math.min(34, layout.width() - 2)}
                  maxWidth={34}
                  backdropColor="transparent"
                >
                  <ScopeChoices
                    current={route.snapshot().destination}
                    onClose={closeOverlay}
                    onSelect={(destination) => {
                      closeOverlay();
                      selectDestination(destination);
                    }}
                  />
                </DialogContent>
              </Show>
            </Dialog>
            <Show when={sessionPayload()?.family === "diagnostic-log" && sessionPayload()} keyed>
              {(payload) =>
                payload.family === "diagnostic-log" ? (
                  <DiagnosticLog text={payload.text} onClose={closeOverlay} />
                ) : null
              }
            </Show>
            <Show when={overlayKind() === "filter"}>
              <SkillsFilterPopup
                workspace={workspaceState}
                projection={projection.workspace}
                onClose={closeOverlay}
              />
            </Show>
            {installedRebindPayload() && (
              <RebindSourceOverlay
                sources={installedRebindPayload()!.sources}
                onClose={closeOverlay}
                onSelect={(owner, ownerPath) => {
                  const surface = installedRebindPayload()!;
                  const skill = installedSkillContext(
                    route.snapshot().destination,
                    projection.workspace(),
                    pageActionFacts(),
                  )?.skill;
                  const address = surface.address ?? skill?.address;
                  if (!address) return;
                  if (surface.sourceRemoval)
                    void previewInstalled(
                      { kind: "rebind", address, owner, ownerPath },
                      surface.sourceRemoval,
                    );
                  else
                    void previewInstalled({
                      kind: "rebind",
                      address,
                      owner,
                      ownerPath,
                    });
                }}
              />
            )}
            {installedPreviewPayload()?.failed && (
              <InstalledSkillPreviewFailureOverlay
                request={installedPreviewPayload()!.request}
                error={operation.problem()}
                pending={overlaySession().phase === "preview"}
                cancelling={overlaySession().phase === "cancelling"}
                onRetry={() => void previewInstalled(installedPreviewPayload()!.request)}
                onCancel={closeOverlay}
              />
            )}
            {installedPreviewPayload() &&
              !installedPreviewPayload()?.failed &&
              !installedPreviewPayload()?.review && (
                <InstalledSkillPreviewOverlay
                  request={installedPreviewPayload()!.request}
                  cancelling={overlaySession().phase === "cancelling"}
                  onCancel={closeOverlay}
                />
              )}
            {collectionChoices() && (
              <CollectionHandoffOverlay
                choices={collectionChoices()!}
                onClose={closeOverlay}
                onSelect={(choice) => {
                  const addresses = payload("collection-choices")!.addresses;
                  if (!choice.level) {
                    openSession("form", {
                      family: "collection-create",
                      allowedLevels: ["global", "project", "local"],
                      fixedCollection: true,
                      afterCreate: { collection: choice.collection, addresses },
                    });
                    return;
                  }
                  openSession("form", {
                    family: "membership-draft",
                    level: choice.level,
                    collection: choice.collection,
                    ...(choice.owner ? { expectedOwner: choice.owner } : {}),
                    additions: addresses.map((address) => ({
                      name: address.path.split("/").at(-1) ?? "skill",
                      address,
                    })),
                  });
                }}
              />
            )}
            {(() => {
              const create = collectionCreate();
              return (
                create && (
                  <CollectionCreateOverlay
                    {...(create.allowedLevels
                      ? { allowedLevels: create.allowedLevels }
                      : { level: create.level! })}
                    collection={create.fixedCollection ? create.afterCreate!.collection : ""}
                    fixed={create.fixedCollection}
                    pending={overlaySession().phase === "executing"}
                    error={operation.problem()}
                    onCancel={closeOverlay}
                    onSubmit={(intent) => {
                      const begun = beginSession(overlaySession().revision, "executing");
                      void effects
                        .createCollection({
                          kind: "collection-create",
                          ...intent,
                        })
                        .then((complete) => {
                          if (
                            complete &&
                            overlaySession().revision === begun.revision &&
                            overlaySession().requestEpoch === begun.requestEpoch
                          ) {
                            const afterCreate = create.afterCreate;
                            collectionsState.select(intent.collection);
                            closeSession(begun.revision);
                            if (afterCreate) {
                              const workspace = projection.workspace();
                              const owner =
                                workspace?.effective.status === "complete"
                                  ? workspace.effective.collectionsView
                                      .find((item) => item.id === afterCreate.collection)
                                      ?.declared.find(
                                        (candidate) =>
                                          !candidate.contribution &&
                                          candidate.level === intent.level,
                                      )
                                  : undefined;
                              if (!owner) {
                                operation.report({
                                  code: "TRANSACTION_CONFLICT",
                                  severity: "warning",
                                  message: "Created Collection owner is unavailable after refresh",
                                });
                                return;
                              }
                              openSession(
                                "form",
                                afterCreate.addresses.length
                                  ? {
                                      family: "membership-draft",
                                      level: intent.level,
                                      collection: afterCreate.collection,
                                      expectedOwner: owner,
                                      additions: afterCreate.addresses.map((address) => ({
                                        name: address.path.split("/").at(-1) ?? "skill",
                                        address,
                                      })),
                                    }
                                  : {
                                      family: "membership-chooser",
                                      level: intent.level,
                                      collection: afterCreate.collection,
                                      expectedOwner: owner,
                                    },
                              );
                            }
                          } else if (
                            overlaySession().revision === begun.revision &&
                            overlaySession().requestEpoch === begun.requestEpoch &&
                            overlaySession().dismissed
                          )
                            closeSession(begun.revision);
                          else settleFailedExecution(begun);
                        });
                    }}
                  />
                )
              );
            })()}
            {overlayKind() === "form" && membershipChooser() && (
              <InstalledSkillChooserOverlay
                skills={(projection.workspace()?.installedSkills ?? []).map((skill) => ({
                  address: skill.address,
                  name: skill.name,
                  description: skill.description,
                }))}
                onClose={() => {
                  closeOverlay();
                }}
                onSelect={(address, name) => {
                  const target = membershipChooser();
                  if (!target) return;
                  openSession("form", {
                    family: "membership-draft",
                    level: target.level,
                    collection: target.collection,
                    expectedOwner: target.expectedOwner,
                    additions: [{ name, address }],
                  });
                }}
              />
            )}
            {overlayKind() === "form" && (
              <Show when={membershipDraft()} fallback={null}>
                {(draft) => (
                  <MembershipBatchDraftOverlay
                    level={draft().level}
                    collection={draft().collection}
                    additions={draft().additions}
                    pending={overlaySession().phase === "preview"}
                    error={operation.problem()}
                    onCancel={closeOverlay}
                    onChange={(index, name) => {
                      const current = membershipDraft();
                      if (!current) return;
                      setSessionPayload({
                        ...current,
                        additions: current.additions.map((item, currentIndex) =>
                          currentIndex === index ? { ...item, name } : item,
                        ),
                      });
                    }}
                    onPreview={() => {
                      const current = membershipDraft();
                      if (!current) return;
                      void previewCollection({
                        kind: "membership-batch",
                        level: current.level,
                        collection: current.collection,
                        ...(current.expectedOwner ? { expectedOwner: current.expectedOwner } : {}),
                        additions: current.additions.map((item) => ({
                          ...item,
                          name: item.name.trim(),
                        })),
                        removals: [],
                      });
                    }}
                  />
                )}
              </Show>
            )}
            {overlayKind() === "form" && membershipRemovalPlan() && (
              <MembershipRemovalPlanOverlay
                collection={membershipRemovalPlan()!.plan.collection}
                lines={[
                  ...membershipRemovalPlan()!.plan.removals.map(
                    (row) => `Remove: ${row.name} ${row.address.source}/${row.address.path}`,
                  ),
                  ...membershipRemovalPlan()!.plan.explanations,
                ]}
                executableCount={membershipRemovalPlan()!.plan.removals.length}
                pending={overlaySession().phase === "preview"}
                error={operation.problem()}
                onCancel={closeOverlay}
                onContinue={() => {
                  const plan = membershipRemovalPlan()!.plan;
                  const owner = plan.ownerGroups[0]?.owner;
                  if (!owner || !plan.executable) return;
                  void previewCollection(
                    {
                      kind: "membership-batch",
                      level: owner.level,
                      collection: plan.collection,
                      expectedOwner: owner,
                      additions: [],
                      removals: plan.removals.map((row) => ({
                        name: row.entryName,
                        expectedAddress: row.address,
                      })),
                    },
                    plan.removals.map((row) => row.key),
                  );
                }}
              />
            )}
            {sourceRegistration() && (
              <SourceRegistrationOverlay
                kind={sourceRegistration()!.kind}
                level={sourceRegistration()!.level}
                pending={overlaySession().phase === "executing"}
                error={operation.problem()}
                onCancel={closeOverlay}
                onSubmit={(value) => {
                  const registration = sourceRegistration()!;
                  const begun = beginSession(overlaySession().revision, "executing");
                  void effects
                    .registerSource({
                      type:
                        registration.kind === "source"
                          ? "source.register"
                          : "config-source.register",
                      level: value.level,
                      id: value.id,
                      binding: value.binding,
                    })
                    .then((complete) => {
                      if (
                        complete &&
                        overlaySession().revision === begun.revision &&
                        overlaySession().requestEpoch === begun.requestEpoch
                      ) {
                        const section =
                          registration.kind === "source" ? "sources" : "config-sources";
                        batch(() => {
                          closeSession(begun.revision);
                          routeSource({
                            destination: value.level,
                            section,
                            selection:
                              registration.kind === "source"
                                ? value.id
                                : `/configSources/${value.id}`,
                          });
                        });
                      } else if (
                        overlaySession().revision === begun.revision &&
                        overlaySession().requestEpoch === begun.requestEpoch &&
                        overlaySession().dismissed
                      )
                        closeSession(begun.revision);
                      else settleFailedExecution(begun);
                    });
                }}
              />
            )}
            <Show when={collectionImportDraft()}>
              {(draft) => (
                <CollectionImportOverlay
                  level={draft().level}
                  from={draft().from}
                  into={draft().into}
                  pending={overlaySession().phase === "preview"}
                  error={operation.problem()}
                  onCancel={closeOverlay}
                  onPreview={(intent) => void previewCollection(intent)}
                />
              )}
            </Show>
            <Show when={collectionReferenceDraft()}>
              {(draft) => (
                <ReferenceOverlay
                  level={draft().level}
                  collection={draft().collection}
                  name={draft().name}
                  target={draft().target}
                  description={draft().description}
                  remove={draft().remove ?? false}
                  pending={overlaySession().phase === "preview"}
                  error={operation.problem()}
                  onCancel={closeOverlay}
                  onPreview={(intent) => void previewCollection(intent)}
                />
              )}
            </Show>
            <Show when={collectionLinkDraft()}>
              {(draft) => (
                <LinkChangeOverlay
                  level={draft().level}
                  collection={draft().collection}
                  target={draft().target}
                  linked={draft().linked}
                  pending={overlaySession().phase === "preview"}
                  error={operation.problem()}
                  onCancel={closeOverlay}
                  onPreview={(intent) => void previewCollection(intent)}
                />
              )}
            </Show>
            <Show when={collectionUseDraft()}>
              {(draft) => (
                <CollectionUseOverlay
                  level={draft().level}
                  collections={draft().collections}
                  currentCollection={collectionDraftPayload()?.useCurrent}
                  onCurrentChange={(useCurrent) => {
                    const current = collectionDraftPayload();
                    if (current?.draft.kind === "collection-use")
                      setSessionPayload({ ...current, useCurrent });
                  }}
                  availableCollections={availableUseCollections()}
                  inventoryUnavailable={projection.workspace()?.effective.status !== "complete"}
                  onChange={(collections) => {
                    const current = collectionDraftPayload();
                    if (current?.draft.kind === "collection-use")
                      setSessionPayload({
                        ...current,
                        draft: { ...current.draft, collections },
                      });
                  }}
                  pending={
                    overlaySession().phase === "preview" || overlaySession().phase === "cancelling"
                  }
                  error={operation.problem()}
                  onCancel={closeOverlay}
                  onPreview={(intent) => void previewCollection(intent)}
                />
              )}
            </Show>
            {overlayKind() === "confirm" && collectionReview() && (
              <CollectionReviewOverlay
                review={collectionReview()!}
                pending={overlaySession().phase === "executing"}
                error={operation.problem()}
                onCancel={closeOverlay}
                onConfirm={() => void applyCollectionReview()}
              />
            )}
            <Show when={configOperation()} keyed fallback={null}>
              {(operation) => {
                const impact = operation.impact;
                return (
                  <box
                    position="absolute"
                    left={0}
                    top={0}
                    width="100%"
                    height="100%"
                    backgroundColor={tokens().colors.background}
                  >
                    <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
                      <text>
                        {operation.kind === "managed"
                          ? `${operation.enabled ? "Enable" : "Disable"} Managed OpenCode`
                          : `${operation.kind[0]!.toUpperCase()}${operation.kind.slice(1)} Config Source`}
                      </text>
                      <text>
                        {operation.kind === "managed"
                          ? `Target: ${operation.file} /agents/opencode`
                          : `Config Source: ${operation.id}`}
                      </text>
                      {operation.kind === "adopt" && (
                        <text>{`Exact revision: ${operation.observation?.exactRevision}`}</text>
                      )}
                      {impact && (
                        <>
                          <text>{`Owner: ${impact.owner.file} ${impact.owner.pointer}`}</text>
                          <text>{`Binding: ${configBindingLine(impact.binding)}`}</text>
                          {impact.currentAppliedCommit && (
                            <text>{`Applied commit: ${impact.currentAppliedCommit}`}</text>
                          )}
                          {impact.exactRevision && (
                            <text>{`Reviewed commit: ${impact.exactRevision}`}</text>
                          )}
                          {impact.delta.addedSources.map((item) => (
                            <text>{`Added Source: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                          ))}
                          {impact.delta.changedSources.map((item) => (
                            <text>{`Changed Source: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                          ))}
                          {impact.delta.removedSources.map((item) => (
                            <text>{`Removed Source: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                          ))}
                          {impact.delta.addedCollections.map((item) => (
                            <text>{`Added Collection: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                          ))}
                          {impact.delta.changedCollections.map((item) => (
                            <text>{`Changed Collection: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                          ))}
                          {impact.delta.removedCollections.map((item) => (
                            <text>{`Removed Collection: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                          ))}
                          {impact.affectedInstalled.map((item) => (
                            <text>{`Affected Installed Skill: ${item.source}/${item.path}`}</text>
                          ))}
                          {impact.disappearingSelectors.map((item) => (
                            <text>{`Disappears: ${item}`}</text>
                          ))}
                          {impact.blockers.map((item) => (
                            <text>{`Blocker: ${item.reason}`}</text>
                          ))}
                          {!impact.allowed && (
                            <text>Operation is blocked by current dependencies.</text>
                          )}
                        </>
                      )}
                      <box flexDirection="column" gap={1} flexShrink={0}>
                        <ModalCommand
                          id="config-operation-review"
                          record={{
                            id: "config-operation.cancel",
                            keys: ["enter"],
                            verb: "Cancel",
                            destination: "Keep current configuration",
                            scope: "modal",
                            enabled: true,
                            danger: false,
                          }}
                          initialFocus
                          execute={closeOverlay}
                        />
                        {(!impact || impact.allowed) && (
                          <ModalCommand
                            id="config-operation-confirm"
                            intent="primary"
                            record={{
                              id: "config-operation.confirm",
                              keys: ["enter"],
                              verb: overlaySession().phase === "executing" ? "Applying" : "Confirm",
                              destination: "Apply reviewed operation",
                              scope: "modal",
                              enabled: overlaySession().phase !== "executing",
                              ...(overlaySession().phase === "executing"
                                ? {
                                    disabledReason: "Wait for the current operation to settle",
                                  }
                                : {}),
                              danger:
                                operation.kind === "forget" ||
                                operation.kind === "remove" ||
                                (operation.kind === "managed" && !operation.enabled),
                            }}
                            execute={() => {
                              const begun = beginSession(overlaySession().revision, "executing");
                              const execute =
                                operation.kind === "adopt"
                                  ? effects.adoptConfig(
                                      operation.id!,
                                      operation.observation!.exactRevision!,
                                      operation.observation!,
                                    )
                                  : operation.kind === "forget"
                                    ? effects.forgetConfig(operation.id!)
                                    : operation.kind === "remove"
                                      ? effects.removeConfig(operation.id!)
                                      : effects.setManagedOpenCode(
                                          operation.level!,
                                          operation.enabled!,
                                        );
                              void execute.then((complete) => {
                                if (
                                  complete &&
                                  sessionMatches(begun, "confirm", "config-operation")
                                )
                                  closeSession(begun.revision);
                                else if (
                                  sessionMatches(begun, "confirm", "config-operation") &&
                                  overlaySession().dismissed
                                )
                                  closeSession(begun.revision);
                                else settleFailedExecution(begun);
                              });
                            }}
                          />
                        )}
                      </box>
                      <text>Cancel is selected by default</text>
                    </box>
                  </box>
                );
              }}
            </Show>
            {installedPreviewPayload()?.review && (
              <InstalledSkillReviewOverlay
                review={installedPreviewPayload()!.review!}
                pending={overlaySession().phase === "executing"}
                error={operation.problem()}
                onResolveMembership={(owner) => {
                  const current = installedPreviewPayload()!.review!;
                  if (current.kind !== "uninstall") return;
                  const selector = current.impact.disappearingSelectors.find(
                    (item) =>
                      item.address.source === current.address.source &&
                      item.address.path === current.address.path &&
                      item.paths.some(
                        (path) =>
                          path.kind === "direct" &&
                          path.owner?.level === owner.level &&
                          path.owner.file === owner.file &&
                          path.owner.pointer === owner.pointer,
                      ),
                  );
                  if (!selector) {
                    operation.report({
                      code: "INVALID_ARGUMENT",
                      severity: "warning",
                      message: `No disappearing selector directly matches ${owner.file} ${owner.pointer}`,
                    });
                    return;
                  }
                  const [collection, entry] = selector.selector.split(":", 2);
                  closeSession();
                  routeSource({
                    destination: owner.level,
                    section: "collections",
                    selection: collection,
                    handoff: {
                      kind: "uninstall-membership",
                      address: current.address,
                      owner,
                      collection,
                      entry,
                    },
                  });
                }}
                onCancel={closeOverlay}
                onConfirm={() => {
                  const surface = installedPreviewPayload()!;
                  const current = surface.review!;
                  if (surface.sourceRemoval) {
                    void confirmRepairInstalled();
                    return;
                  }
                  const begun = beginSession(overlaySession().revision, "executing");
                  void effects.confirmInstalled(current).then((complete) => {
                    if (
                      complete &&
                      overlaySession().revision === begun.revision &&
                      overlaySession().requestEpoch === begun.requestEpoch
                    ) {
                      if (current.kind === "rebind")
                        workspaceState.selectSkill({
                          source: current.impact.owner,
                          path: current.impact.ownerPath,
                        });
                      closeSession(begun.revision);
                    } else if (
                      overlaySession().revision === begun.revision &&
                      overlaySession().requestEpoch === begun.requestEpoch &&
                      overlaySession().dismissed
                    )
                      closeSession(begun.revision);
                    else settleFailedExecution(begun);
                  });
                }}
              />
            )}
            {sourceRemovalPayload()?.review &&
              (() => {
                const removal = sourceRemovalPayload()!.review!;
                return (
                  <SourceRemovalOverlay
                    review={removal}
                    pending={overlaySession().phase === "executing"}
                    error={operation.problem()}
                    onConfirm={() => {
                      void confirm();
                    }}
                    onCancel={closeOverlay}
                    onRepair={(action, address) => {
                      const current = removal;
                      if (action === "uninstall")
                        void previewRepairInstalled({ kind: "uninstall", address }, current);
                      else {
                        const sources = projection
                          .workspace()
                          ?.effective.sources.filter((source) => source.id !== address.source)
                          .map((source) => source.id);
                        if (sources?.length)
                          openSession("selection", {
                            family: "installed-rebind",
                            sources,
                            address,
                            sourceRemoval: current,
                          });
                        else
                          operation.report({
                            code: "SOURCE_NOT_FOUND",
                            severity: "warning",
                            message: "No alternative Source is available for Rebind",
                          });
                      }
                    }}
                  />
                );
              })()}
            <Show when={sourceSelectionPayload()} fallback={null}>
              {(selection) => (
                <SourceSelectionOverlay
                  review={selection().review}
                  installed={
                    new Set(
                      (projection.workspace()?.installedSkills ?? [])
                        .filter(
                          (skill) => skill.address.source === selection().review.observation.source,
                        )
                        .map((skill) => skill.address.path),
                    )
                  }
                  selected={selection().selectedPaths}
                  pending={overlaySession().phase === "executing"}
                  error={operation.problem()}
                  onToggle={(path) => {
                    const current = selection();
                    replaceSession(overlaySession().revision, {
                      ...current,
                      selectedPaths: current.selectedPaths.includes(path)
                        ? current.selectedPaths.filter((value) => value !== path)
                        : [...current.selectedPaths, path],
                    });
                  }}
                  onSubmit={() => {
                    void applySourceSelection();
                  }}
                  onCancel={closeOverlay}
                />
              )}
            </Show>
            {overlayKind() === "selection" && configObservationPayload() && (
              <SourceObservationOverlay
                title="Observing Config"
                source={configObservationPayload()!.id}
                cancelling={overlaySession().phase === "cancelling"}
                error={operation.problem()}
                onRetry={() => {
                  operation.clearProblem();
                  const revision = overlaySession().revision;
                  setOverlaySession((current) =>
                    reduceOverlaySession(current, {
                      type: "retry",
                      revision,
                      phase: "observing",
                    }),
                  );
                  const attempt = overlaySession();
                  void observeConfig(configObservationPayload()!.id, attempt);
                }}
                onClose={closeOverlay}
              />
            )}
            {overlayKind() === "selection" && sourceObservationPayload() && (
              <SourceObservationOverlay
                title="Discovering Skills"
                source={sourceObservationPayload()!.intent.source}
                cancelling={overlaySession().phase === "cancelling"}
                error={operation.problem()}
                onRetry={() => {
                  const intent = sourceObservationPayload()!.intent;
                  operation.clearProblem();
                  const revision = overlaySession().revision;
                  setOverlaySession((current) =>
                    reduceOverlaySession(current, {
                      type: "retry",
                      revision,
                      phase: "observing",
                    }),
                  );
                  const attempt = overlaySession();
                  void effects.discover(intent).then((next) => {
                    if (
                      next &&
                      sessionMatches(attempt, "selection", "source-observation") &&
                      !overlaySession().dismissed
                    )
                      settleSession(attempt.revision, attempt.requestEpoch, "review", {
                        family: "source-selection",
                        review: next,
                        selectedPaths: [],
                      });
                    else if (
                      sessionMatches(attempt, "selection", "source-observation") &&
                      overlaySession().dismissed
                    )
                      closeSession(attempt.revision);
                    else if (sessionMatches(attempt, "selection", "source-observation"))
                      settleSession(attempt.revision, attempt.requestEpoch, "review");
                  });
                }}
                onClose={closeOverlay}
              />
            )}
            {overlayKind() === "confirm" &&
              (!sessionPayload() || (sourceRemovalPayload() && !sourceRemovalPayload()?.review)) &&
              !collectionReview() &&
              !configOperation() && (
                <box
                  position="absolute"
                  left={0}
                  top={0}
                  width="100%"
                  height="100%"
                  backgroundColor={tokens().colors.background}
                >
                  <text>Reviewing Source removal impact. Escape Cancel</text>
                </box>
              )}
          </PageNavigationProvider>
        </ModalControlsProvider>
      )}
    </Show>
  );
}

export async function runTui(core: SkillCliCore): Promise<void> {
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    exitOnCtrlC: false,
    useMouse: true,
    consoleMode: "console-overlay",
  });
  let exiting = false;
  const exit = () => {
    if (!exiting) {
      exiting = true;
      renderer.destroy();
    }
  };
  const destroyed = new Promise<void>((resolve) => renderer.on("destroy", resolve));
  try {
    await render(() => <App core={core} exit={exit} />, renderer);
  } catch (error) {
    exit();
    throw error;
  }
  await destroyed;
}
