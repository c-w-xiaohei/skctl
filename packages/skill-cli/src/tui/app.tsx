import { createCliRenderer, InputRenderable } from "@opentui/core";
import { onResize, render, useKeyboard, useRenderer } from "@opentui/solid";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { batch, createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type {
  ConfigSourceObservation,
  ConfigSourceImpact,
  InstalledSkillSelectorViews,
  SkillCliCore,
} from "../core/api";
import type { SkillAddress } from "../core/collections";
import {
  actionIntent,
  installedSkillContext,
  reachableActions,
  sourceRouteIntent,
  sourceOperationIntent,
  skillSourceIntent,
  type ActionId,
} from "./actions";
import {
  createTuiEffects,
  type SourceRemovalReview,
  type DiscoveryReview,
  type UpdateReview,
  type InstalledSkillReview,
  type TuiCore,
} from "./effects";
import {
  destinations,
  focusOwners,
  readerOwnsFocus,
  type Destination,
  type FocusOwner,
  type Section,
} from "./types";
import {
  ActionOverlay,
  SourceRemovalOverlay,
  SourceObservationOverlay,
  SourceSelectionOverlay,
  AgentPathsOverlay,
  CollectionCreateOverlay,
  InstalledSkillPreviewFailureOverlay,
  InstalledSkillPreviewOverlay,
  InstalledSkillReviewOverlay,
  RebindSourceOverlay,
  CollectionHandoffOverlay,
  CollectionReviewOverlay,
  MembershipAddOverlay,
  InstalledSkillChooserOverlay,
  SourceRegistrationOverlay,
  CollectionImportOverlay,
  ReferenceOverlay,
  LinkChangeOverlay,
  CollectionUseOverlay,
  type InstalledSkillPreviewRequest,
} from "./operations";
import { WorkspacePage } from "./workspace-page";
import { ConfigPage } from "./config-page";
import { filterDimensions } from "./types";
import { filterSkills, filterValues } from "./skills-filter";
import type { CollectionRelationshipIntent } from "./collections-page";
import { createFocus } from "./focus";
import { createLayout } from "./layout";
import { createProjection } from "./projection";
import { createWorkspaceState } from "./workspace/state";
import { createCollectionsState } from "./collections/state";
import { createConfigState } from "./config/state";
import { createOperationState } from "./operation-state";
import {
  activeReader,
  beginReaderRequest,
  createReaderState,
  reduceReaderEvent,
  reduceReaderState,
} from "./reader/state";
import { SectionTabs } from "./components/section-tabs";
import { parseNavKey, resolve } from "./navigation";
import { createRoute, type RelationshipTarget, type RouteTarget } from "./route";
import {
  createOverlaySession,
  reduceOverlaySession,
  sessionMatches as sessionMatchesOverlay,
} from "./overlays/session";
import { theme } from "./ui/theme";

const topOptions = destinations.map((value) => ({
  label: value === "workspace" ? "Workspace" : value[0]!.toUpperCase() + value.slice(1),
  value,
}));
const isDestination = (value: ActionId | Destination): value is Destination =>
  destinations.some((destination) => destination === value);
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
      readonly review: DiscoveryReview | UpdateReview;
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
  | {
      readonly family: "installed-agent-views";
      readonly views: InstalledSkillSelectorViews;
    }
  | { readonly family: "palette" }
  | {
      readonly family: "skills-filter";
      readonly dimension?: string;
      readonly search: string;
    }
  | {
      readonly family: "collection-choices";
      readonly choices: readonly {
        readonly collection: string;
        readonly level?: "global" | "project" | "local";
      }[];
    }
  | {
      readonly family: "collection-create";
      readonly level?: "global" | "project" | "local";
      readonly allowedLevels?: readonly ("global" | "project" | "local")[];
      readonly afterCreate?: {
        readonly collection: string;
        readonly address: { readonly source: string; readonly path: string };
      };
    }
  | {
      readonly family: "membership-chooser";
      readonly level: "global" | "project" | "local";
      readonly collection: string;
    }
  | {
      readonly family: "membership-draft";
      readonly level: "global" | "project" | "local";
      readonly collection: string;
      readonly address: { readonly source: string; readonly path: string };
      readonly initialName: string;
      readonly review?: CollectionReview;
    }
  | { readonly family: "collection-draft"; readonly draft: CollectionDraft }
  | { readonly family: "collection-review"; readonly review?: CollectionReview }
  | {
      readonly family: "config-operation";
      readonly kind: "adopt" | "forget" | "remove" | "managed";
      readonly id?: string;
      readonly observation?: ConfigSourceObservation;
      readonly impact?: ConfigSourceImpact;
      readonly level?: "global" | "project" | "local";
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
  const [readerState, setReaderState] = createSignal(createReaderState());
  const reader = () => activeReader(readerState());
  const readerDispatch = (event: Parameters<typeof reduceReaderState>[1]) => {
    let accepted = false;
    let activeFailure = false;
    setReaderState((current) => {
      const reduced = reduceReaderEvent(current, event);
      accepted = reduced.accepted;
      activeFailure =
        event.type === "failure" &&
        reduced.state.activeKey === `${event.address.source}/${event.address.path}` &&
        activeReader(reduced.state)?.resourceLevel === "content";
      return reduced.state;
    });
    if (accepted && activeFailure) requestFocus("reader-tabs");
  };
  const workspaceState = createWorkspaceState((selected) => {
    const address = projection
      .workspace()
      ?.installedSkills.find(
        (item) => `${item.address.source}/${item.address.path}` === selected,
      )?.address;
    if (address) selectReaderSkill(address, true);
  });
  const collectionsState = createCollectionsState();
  const configState = createConfigState();
  const renderer = useRenderer();
  const stopThemeFollow = theme.follow(renderer);
  const focus = createFocus("browser");
  const focusRegistry = focus.registry;
  const layout = createLayout();
  const [focusVersion, setFocusVersion] = createSignal(focusRegistry.version());
  const [readerFocusUnblocked, setReaderFocusUnblocked] = createSignal(0);
  const stopFocusSubscription = focusRegistry.subscribe(setFocusVersion);
  const focusOwner = focus.desired;
  let readerFocusWasBlocked = false;
  const registeredFocus = (fallback: FocusOwner): FocusOwner =>
    focusOwners.find(
      (owner) => focusRegistry.target(owner) === renderer.currentFocusedRenderable,
    ) ?? fallback;
  const syncPhysicalFocus = () => {
    if (!physicalFocusBridgeReady || !appliedFocusOwner) return;
    const observed = registeredFocus(focus.desired() ?? "browser");
    const routeSnapshot = route.snapshot();
    if (
      routeSnapshot.destination === "workspace" &&
      workspaceState.section() === "skills" &&
      !!reader()?.address &&
      readerOwnsFocus(observed) &&
      observed !== focus.desired()
    )
      requestFocus(observed);
  };
  renderer.on("focused_renderable", syncPhysicalFocus);
  let route: ReturnType<typeof createRoute>;
  const requestFocus = (owner: FocusOwner) => {
    if (
      route.snapshot().destination === "workspace" &&
      workspaceState.section() === "skills" &&
      reader()?.address &&
      readerOwnsFocus(owner)
    ) {
      readerDispatch({ type: "patch", value: { focus: owner } });
    }
    focus.request(owner);
  };
  route = createRoute(
    { workspace: workspaceState, config: configState },
    requestFocus,
    () => closeSession(),
    reader,
    (address, surface) => readerDispatch({ type: "select", address, surface }),
    (selection) => {
      const address = projection
        .workspace()
        ?.installedSkills.find(
          (skill) => `${skill.address.source}/${skill.address.path}` === selection,
        )?.address;
      batch(() => {
        workspaceState.land("skills", selection);
        if (address) selectReaderSkill(address);
      });
    },
  );
  createEffect(() => {
    const blocked = !!overlaySession().kind || !!operation.task();
    if (readerFocusWasBlocked && !blocked && focusOwner() && readerOwnsFocus(focusOwner()!))
      setReaderFocusUnblocked((value) => value + 1);
    readerFocusWasBlocked = blocked;
  });
  const routeSource = (target: RouteTarget) => route.source(target);
  const routeRelationship = (target: RelationshipTarget) => route.relationship(target);
  const projection = createProjection(operation, {
    workspace: workspaceState,
    collections: collectionsState,
    config: configState,
  });
  const effects = createTuiEffects(
    props.core,
    operation,
    projection.outcomes,
    readerDispatch,
    (address, request, path) => {
      let start: ReturnType<typeof beginReaderRequest>["event"] | undefined;
      setReaderState((current) => {
        const begun = beginReaderRequest(current, address, request, path);
        start = begun.event;
        return begun.state;
      });
      return start!;
    },
  );
  const sessionPayload = () => overlaySession().payload as AppOverlayPayload | undefined;
  const payload = <Family extends AppOverlayPayload["family"]>(family: Family) => {
    const value = sessionPayload();
    return value?.family === family
      ? (value as Extract<AppOverlayPayload, { readonly family: Family }>)
      : undefined;
  };
  const skillsFilterPayload = () => payload("skills-filter");
  const collectionChoicesPayload = () => payload("collection-choices");
  const collectionCreatePayload = () => payload("collection-create");
  const membershipChooserPayload = () => payload("membership-chooser");
  const membershipDraftPayload = () => payload("membership-draft");
  const collectionDraftPayload = () => payload("collection-draft");
  const collectionReviewPayload = () => payload("collection-review");
  const configOperationPayload = () => payload("config-operation");
  const sourceRegistrationPayload = () => payload("source-registration");
  const collectionChoices = () => collectionChoicesPayload()?.choices;
  const collectionCreate = collectionCreatePayload;
  const membershipChooser = membershipChooserPayload;
  const membershipDraft = membershipDraftPayload;
  const collectionDraft = () => collectionDraftPayload()?.draft;
  const collectionReview = () => collectionReviewPayload()?.review;
  const configOperation = configOperationPayload;
  const sourceRegistration = sourceRegistrationPayload;
  const filterDimension = () => skillsFilterPayload()?.dimension;
  const filterSearch = () => skillsFilterPayload()?.search ?? "";
  const sourceRemovalPayload = () => {
    const value = sessionPayload();
    return value?.family === "source-removal" ? value : undefined;
  };
  const sourceObservationPayload = () => {
    const value = sessionPayload();
    return value?.family === "source-observation" ? value : undefined;
  };
  const configObservationPayload = () => payload("config-observation");
  const sourceSelectionPayload = () => {
    const value = sessionPayload();
    return value?.family === "source-selection" ? value : undefined;
  };
  const installedPreviewPayload = () => {
    const value = sessionPayload();
    return value?.family === "installed-preview" ? value : undefined;
  };
  const installedRebindPayload = () => {
    const value = sessionPayload();
    return value?.family === "installed-rebind" ? value : undefined;
  };
  const installedAgentViewsPayload = () => {
    const value = sessionPayload();
    return value?.family === "installed-agent-views" ? value : undefined;
  };
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
          restoreFocus: focus.desired() ?? registeredFocus("browser"),
        }),
      );
    });
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
  const closeSession = (revision = overlaySession().revision) => {
    const current = overlaySession();
    if (!current.kind || current.revision !== revision) return;
    const restoreFocus = current.restoreFocus;
    // A close's captured owner is only valid until another semantic focus request wins.
    const focusRevision = focus.revision();
    setOverlaySession((session) => reduceOverlaySession(session, { type: "close", revision }));
    queueMicrotask(() => {
      if (focus.revision() === focusRevision && restoreFocus) requestFocus(restoreFocus);
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
  const selectReaderSkill = (address: SkillAddress, preserveSurface = false) => {
    const current = reader();
    if (current?.address?.source === address.source && current.address?.path === address.path)
      return;
    readerDispatch({ type: "select", address });
    if (preserveSurface && current)
      readerDispatch({
        type: "patch",
        value: { tab: current.tab, focus: current.focus },
      });
    void effects.loadReader(address);
  };
  const selectReaderTab = (tab: import("./types").ReaderState["tab"]) => {
    readerDispatch({
      type: "patch",
      value: {
        tab,
        resource: undefined,
        resourceLevel: "list",
        resourceLoading: false,
        error: undefined,
      },
    });
    if (tab === "resources") ensureResources();
  };
  const ensureResources = () => {
    const current = reader();
    if (current?.address && !current.resourcesLoaded && !current.resourceLoading && !current.error)
      void effects.listResources(current.address);
  };
  const openReaderSkill = (address: SkillAddress) => {
    batch(() => {
      workspaceState.selectSkill(`${address.source}/${address.path}`);
      selectReaderSkill(address);
    });
    const selected = reader();
    const readerFocus: FocusOwner =
      selected?.focus ??
      (selected?.tab === "resources"
        ? selected.resourceLevel === "content"
          ? "reader-resource-content"
          : "reader-resource-list"
        : selected?.tab === "details"
          ? "inspector"
          : "reader");
    workspaceState.openDetail();
    requestFocus(readerFocus);
  };
  const FilterSearch = () => {
    let input: InputRenderable | undefined;
    onMount(() => queueMicrotask(() => input?.focus()));
    return (
      <input
        id="skills-filter-search"
        ref={(value: InputRenderable) => {
          input = value;
        }}
        focused
        placeholder={skillsFilterPayload()?.dimension ? "Search values" : "Search dimensions"}
        value={skillsFilterPayload()?.search ?? ""}
        onInput={(search) => {
          const current = skillsFilterPayload();
          if (current) setSessionPayload({ ...current, search });
        }}
      />
    );
  };
  const selectFilterDimension = (dimension: string) => {
    const current = skillsFilterPayload();
    if (current) setSessionPayload({ ...current, dimension, search: "" });
  };
  const selectFilterValue = (dimension: string, value: string) => {
    workspaceState.setFilter(dimension, value || undefined);
    const workspace = projection.workspace();
    if (workspace) workspaceState.reconcile(workspace, workspace);
    const current = skillsFilterPayload();
    if (current) setSessionPayload({ ...current, dimension: undefined, search: "" });
    closeSession();
    requestFocus("browser");
  };
  let appliedFocusOwner: FocusOwner | undefined;
  let appliedFocusTarget: unknown;
  let physicalFocusBridgeReady = false;
  let focusReconciliationRevision = 0;
  let configFocusRevision = 0;
  let pendingConfigFocus:
    | {
        readonly revision: number;
        readonly destination: Exclude<Destination, "workspace">;
        readonly section: Section;
        readonly listener: () => void;
      }
    | undefined;
  const currentInstalledPreview = (request: InstalledSkillPreviewRequest) => {
    const workspace = projection.workspace();
    const selected = workspaceState.selectedSkill();
    const selectedAddress = `${request.address.source}/${request.address.path}`;
    return !!(
      workspace &&
      selected === selectedAddress &&
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
    const payload = sessionPayload();
    const revision = overlaySession().revision;
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
      if (payload.review.kind === "discovery") effects.discardDiscovery(payload.review);
      else effects.discardUpdate(payload.review);
      closeSession();
      return;
    } else if (
      payload?.family === "installed-rebind" ||
      payload?.family === "installed-agent-views"
    ) {
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
    const impact = await effects.previewConfig({ kind: "adopt", id, observation });
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
  const dispatchAction = async (id: ActionId) => {
    const workspace = projection.workspace();
    if (!workspace) return;
    const pageFacts = {
      workspace: workspaceState.snapshot(),
      collections: collectionsState.snapshot(),
      config: (destination: Exclude<Destination, "workspace">) => configState.snapshot(destination),
    };
    if (id === "open-actions" || id === "open-palette") {
      openSession(id === "open-actions" ? "actions" : "palette", {
        family: "palette",
      });
      return;
    }
    const descriptor = reachableActions(route.snapshot().destination, workspace, pageFacts).find(
      (action) => action.id === id,
    );
    // The cold-start primary action reaches the same Source registration form before actions exist.
    const coldStartAddSource =
      id === "add-source" &&
      route.snapshot().destination === "workspace" &&
      workspaceState.section() === "skills" &&
      !workspaceState.sourceFilter() &&
      workspace.installedSkills.length === 0;
    if (!descriptor?.enabled && !coldStartAddSource) {
      if (descriptor?.reason)
        operation.report({
          code: "INVALID_ARGUMENT",
          severity: "warning",
          message: descriptor.reason!,
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
    if (id === "config-observe") {
      const config = workspace.configs.find((item) => item.level === route.snapshot().destination);
      const source = config?.direct.configSources.find(
        (item) =>
          item.owner.pointer === configState.selection(configDestination(), "config-sources"),
      );
      if (!source) return;
      beginConfigObservation(source.id);
      return;
    }
    if (id === "config-adopt" || id === "config-forget" || id === "config-remove") {
      const config = workspace.configs.find((item) => item.level === route.snapshot().destination);
      const source = config?.direct.configSources.find(
        (item) =>
          item.owner.pointer === configState.selection(configDestination(), "config-sources"),
      );
      if (!source) return;
      if (id === "config-adopt") {
        beginConfigObservation(source.id);
      } else {
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
      }
      return;
    }
    if (id === "enable-managed-opencode" || id === "disable-managed-opencode") {
      const destination = route.snapshot().destination;
      if (destination === "workspace") return;
      openSession("confirm", {
        family: "config-operation",
        kind: "managed",
        level: destination,
        enabled: id === "enable-managed-opencode",
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
      if (!collection || !owner) return;
      openSession("form", {
        family: "membership-chooser",
        level: owner.level,
        collection: collection.id,
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
        const begun = beginSession(overlaySession().revision, "preview");
        const next = await effects.previewCollectionRemoval({
          kind: "collection-removal",
          level: owner.level,
          collection,
        });
        if (!sessionMatches(begun, "confirm", "collection-review")) return;
        if (overlaySession().dismissed) return closeSession(begun.revision);
        if (next?.kind === "collection-removal")
          settleSession(begun.revision, begun.requestEpoch, "review", {
            family: "collection-review",
            review: next,
          });
        else closeSession(begun.revision);
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
    if (id === "add-skills" || id === "check-updates") {
      const intent = sourceOperationIntent(id, route.snapshot().destination, workspace, pageFacts);
      operation.clearProblem();
      openSession("selection", { family: "source-observation", intent }, "observing");
      const begun = beginSession(overlaySession().revision, "observing");
      const { revision, requestEpoch } = begun;
      const next =
        id === "add-skills"
          ? await effects.discover({
              kind: "source-discovery",
              source: intent.source,
            })
          : await effects.checkUpdate({
              kind: "source-update",
              source: intent.source,
            });
      if (
        next &&
        sessionMatches(begun, "selection", "source-observation") &&
        !overlaySession().dismissed
      )
        settleSession(revision, requestEpoch, "review", {
          family: "source-selection",
          review: next,
          selectedPaths: [],
        });
      else if (
        sessionMatches(begun, "selection", "source-observation") &&
        overlaySession().dismissed
      )
        closeSession(revision);
      else if (sessionMatches(begun, "selection", "source-observation"))
        settleSession(revision, requestEpoch, "review");
      return;
    }
    if (id === "view-installed-skills") {
      const destination = route.snapshot().destination;
      const source = sourceOperationIntent("add-skills", destination, workspace, pageFacts).source;
      const first = projection
        .workspace()
        ?.installedSkills.find((skill) => skill.address.source === source);
      const target = {
        destination: "workspace" as const,
        section: "skills" as const,
        selection: first ? `${first.address.source}/${first.address.path}` : undefined,
      };
      if (destination === "workspace") routeSource(target);
      else
        route.contribution(target, {
          destination,
          section: configState.section(destination),
          selection: configState.selection(destination),
        });
      batch(() => {
        workspaceState.selectSource(source);
        workspaceState.showInstalledSkillsFromSource(source);
      });
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
    if (id === "skill-add-to-collection") {
      const skill = installedSkillContext(
        route.snapshot().destination,
        workspace,
        pageFacts,
      )?.skill;
      const choices =
        workspace.effective.status === "complete"
          ? workspace.effective.collectionsView.flatMap((item) =>
              item.declared.some((owner) => !owner.contribution)
                ? item.declared
                    .filter((owner) => !owner.contribution)
                    .map((owner) => ({
                      collection: item.id,
                      level: owner.level,
                    }))
                : item.repository.derived
                  ? [{ collection: item.id }]
                  : [],
            )
          : [];
      if (!skill || choices.length === 0) {
        operation.report({
          code: "INVALID_ARGUMENT",
          severity: "warning",
          message: "No direct Collection is available for this Installed Skill",
        });
        return;
      }
      openSession("selection", { family: "collection-choices", choices });
      return;
    }
    if (id === "skill-for-agents") {
      const skill = installedSkillContext(
        route.snapshot().destination,
        workspace,
        pageFacts,
      )?.skill;
      if (skill?.selectorViews.status === "complete") {
        openSession("selection", {
          family: "installed-agent-views",
          views: skill.selectorViews,
        });
      }
      return;
    }
    if (id === "skill-uninstall") {
      const skill = installedSkillContext(
        route.snapshot().destination,
        workspace,
        pageFacts,
      )?.skill;
      if (!skill) return;
      void previewInstalled({ kind: "uninstall", address: skill.address });
      return;
    }
    if (id === "skill-rebind") {
      const skill = installedSkillContext(
        route.snapshot().destination,
        workspace,
        pageFacts,
      )?.skill;
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
      const skill = workspace.installedSkills.find(
        (item) => `${item.address.source}/${item.address.path}` === workspaceState.selectedSkill(),
      );
      if (skill) {
        const intent = skillSourceIntent(route.snapshot().destination, workspace, pageFacts);
        openSession("selection", { family: "source-observation", intent }, "observing");
        const begun = beginSession(overlaySession().revision, "observing");
        const { revision, requestEpoch } = begun;
        const next = await effects.checkUpdate({
          kind: intent.kind,
          source: intent.source,
          selectedPath: intent.path,
        });
        if (
          next &&
          sessionMatches(begun, "selection", "source-observation") &&
          !overlaySession().dismissed
        )
          settleSession(revision, requestEpoch, "review", {
            family: "source-selection",
            review: next,
            selectedPaths: [],
          });
        else if (
          sessionMatches(begun, "selection", "source-observation") &&
          overlaySession().dismissed
        )
          closeSession(revision);
      }
      return;
    }
    if (id === "skill-open-source") {
      const skill = installedSkillContext(
        route.snapshot().destination,
        workspace,
        pageFacts,
      )?.skill;
      if (skill)
        routeSource({
          destination: "workspace",
          section: "sources",
          selection: skill.owner.source,
        });
    }
  };
  const previewMembership = async (
    intent: import("./effects").AddMembershipPreviewRequest,
    origin: "confirm" | "form" = "confirm",
  ) => {
    const begun = beginSession(overlaySession().revision, "preview");
    const next = await effects.previewAddToCollection(intent);
    if (
      !sessionMatches(begun, origin, origin === "form" ? "membership-draft" : "collection-review")
    )
      return;
    if (overlaySession().dismissed) return closeSession(begun.revision);
    if (next?.kind !== "add-to-collection")
      return settleSession(begun.revision, begun.requestEpoch, "review");
    if (next.authorized) {
      if (origin === "form") openSession("confirm", { family: "collection-review", review: next });
      else
        openSession("form", {
          family: "membership-draft",
          level: next.authorized.level,
          collection: next.authorized.collection,
          address: next.authorized.address,
          initialName: next.authorized.name,
          review: next,
        });
      return;
    }
    if (next.nextStep) {
      effects.discardCollectionReview(next);
      openSession("form", {
        family: "collection-create",
        allowedLevels: next.nextStep.eligibleLevels,
        afterCreate: { collection: intent.collection, address: intent.address },
      });
      return;
    }
    setSessionPayload({ family: "collection-review", review: next });
  };
  const applyCollectionReview = async () => {
    const current = collectionReviewPayload()?.review;
    if (!current) return;
    const begun = beginSession(overlaySession().revision, "executing");
    const complete =
      current.kind === "membership-removal"
        ? await effects.removeMembership(current)
        : current.kind === "collection-import"
          ? await effects.importCollection(current)
          : current.kind === "reference"
            ? await effects.changeReference(current)
            : current.kind === "link-change"
              ? await effects.changeLink(current)
              : current.kind === "collection-use"
                ? await effects.setCollectionUse(current)
                : current.kind === "collection-removal"
                  ? await effects.removeCollection(current)
                  : false;
    if (complete && sessionMatches(begun, "confirm", "collection-review")) {
      const collection =
        current.kind === "collection-import"
          ? current.intent.into
          : current.kind === "collection-use"
            ? undefined
            : current.intent.collection;
      if (collection) collectionsState.select(collection);
      closeSession();
    } else if (sessionMatches(begun, "confirm", "collection-review") && overlaySession().dismissed)
      closeSession(begun.revision);
    else settleFailedExecution(begun);
  };
  const applyMembership = async () => {
    const current = collectionReviewPayload()?.review;
    if (current?.kind !== "add-to-collection" || !current.authorized) return;
    const begun = beginSession(overlaySession().revision, "executing");
    const complete = await effects.addToCollection(current);
    if (complete && sessionMatches(begun, "confirm", "collection-review")) {
      const collection = current.authorized.collection;
      collectionsState.select(collection);
      closeSession();
    } else if (sessionMatches(begun, "confirm", "collection-review") && overlaySession().dismissed)
      closeSession(begun.revision);
    else settleFailedExecution(begun);
  };
  const previewMembershipRemoval = async (
    intent: Extract<import("./effects").CollectionIntent, { readonly kind: "membership-removal" }>,
  ) => {
    openSession("confirm", { family: "collection-review" });
    const begun = beginSession(overlaySession().revision, "preview");
    const next = await effects.previewMembershipRemoval(intent);
    if (!sessionMatches(begun, "confirm", "collection-review")) return;
    if (overlaySession().dismissed || next?.kind !== "membership-removal")
      return closeSession(begun.revision);
    else
      settleSession(begun.revision, begun.requestEpoch, "review", {
        family: "collection-review",
        review: next,
      });
  };
  const previewCollectionDraft = async (
    run: () => Promise<CollectionReview | undefined>,
    kind: CollectionReview["kind"],
  ) => {
    const begun = beginSession(overlaySession().revision, "preview");
    const review = await run();
    if (!sessionMatches(begun, "form", "collection-draft")) return;
    if (overlaySession().dismissed) return closeSession(begun.revision);
    if (!review || review.kind !== kind)
      return settleSession(begun.revision, begun.requestEpoch, "review");
    openSession("confirm", { family: "collection-review", review });
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
    const complete =
      current.kind === "discovery"
        ? await effects.install(current, surface.selectedPaths)
        : await effects.update(current, surface.selectedPaths);
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
    const visibleReader = filterSkills(workspace?.installedSkills ?? [], {
      query: workspaceState.query(),
      filters: workspaceState.filters(),
      source: workspaceState.sourceFilter(),
      agentStatus: workspace?.effective.agent.status,
    }).find(
      (skill) => `${skill.address.source}/${skill.address.path}` === workspaceState.selectedSkill(),
    );
    const collectionFilter = collectionsState.filter();
    return {
      destination: route.snapshot().destination,
      section:
        route.snapshot().destination === "workspace"
          ? workspaceState.section()
          : configState.section(configDestination()),
      focus: registeredFocus(focus.desired() ?? "browser"),
      overlay: overlayKind(),
      task: !!operation.task(),
      narrow: layout.narrow(),
      narrowLevel: workspaceState.narrowLevel(),
      sourceFilter: !!workspaceState.sourceFilter(),
      canReturn: route.canReturn(),
      emptyWorkspaceAction: renderer.currentFocusedRenderable?.id === "empty-workspace-action",
      nativeInput: renderer.currentFocusedRenderable instanceof InputRenderable,
      tabsPart: renderer.currentFocusedRenderable instanceof TabsTabRenderable,
      readerActive:
        route.snapshot().destination === "workspace" &&
        workspaceState.section() === "skills" &&
        !!visibleReader &&
        !!reader()?.address &&
        `${reader()!.address!.source}/${reader()!.address!.path}` ===
          `${visibleReader.address.source}/${visibleReader.address.path}`,
      readerTab: reader()?.tab ?? "skill",
      readerRetry: !!reader()?.error,
      readerResourceLevel: reader()?.resourceLevel,
      collectionFilterOpen: collectionFilter.open,
      collectionFilterDimension: !!collectionFilter.dimension,
      skillsFilterAvailable: !!renderer.root.findDescendantById("open-skills-filter"),
      collectionsFilterAvailable: !!focusRegistry.target("collections-filter-open"),
    } as const;
  };
  const applyNavigation = (decision: ReturnType<typeof resolve>) => {
    if (!decision) return false;
    if (decision.kind === "events") {
      batch(() => {
        for (const event of decision.events) {
          if (event.type === "route.back") route.back();
          else if (event.type === "destination.select") selectDestination(event.destination);
          else if (event.type === "collections.filter.back")
            collectionsState.chooseFilterDimension();
          else if (event.type === "collections.filter.close") collectionsState.closeFilter();
          else if (event.type === "workspace.source-filter.clear")
            workspaceState.clearSourceFilter();
          else if (event.type === "palette.open") openSession("palette", { family: "palette" });
          else if (event.type === "reader.patch") {
            if (event.value.tab) selectReaderTab(event.value.tab);
            else readerDispatch({ type: "patch", value: event.value });
          } else if (event.type === "focus.request") requestFocus(event.focus);
          else if (event.type === "narrow.open-detail") workspaceState.openDetail();
          else if (event.type === "narrow.show-list") workspaceState.showList();
        }
      });
    } else if (decision.effect === "exit" && !exitRequested) {
      exitRequested = true;
      props.exit();
    } else if (decision.effect === "close-surface" || decision.effect === "cancel-operation")
      closeOverlay();
    return true;
  };
  const interceptPriorityKey = (event: {
    readonly name: string;
    readonly ctrl: boolean;
    readonly shift: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    const name = event.name.toLowerCase();
    if (event.ctrl && name === "p" && overlaySession().dismissed) {
      openSession("palette", { family: "palette" });
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      (overlayKind() || operation.task()) &&
      (name === "escape" || name === "esc" || (event.ctrl && name === "c"))
    ) {
      if (overlayKind() === "filter" && skillsFilterPayload()?.dimension) {
        setSessionPayload({ family: "skills-filter", search: "" });
      } else closeOverlay();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const focused = renderer.currentFocusedRenderable;
    const interceptTabs = focused instanceof TabsTabRenderable;
    const interceptColdStart = focused?.id === "empty-workspace-action";
    if (
      !overlayKind() &&
      !operation.task() &&
      ((name === "tab" && (interceptTabs || interceptColdStart)) ||
        ((name === "enter" || name === "return") && interceptTabs))
    ) {
      if (applyNavigation(resolve(navigationFacts(), parseNavKey(event)))) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };
  renderer.keyInput.prependListener("keypress", interceptPriorityKey);
  useKeyboard((event) => {
    if (event.defaultPrevented) return;
    physicalFocusBridgeReady = true;
    const observedFocus = registeredFocus(focus.desired() ?? "browser");
    if (observedFocus !== focus.desired()) requestFocus(observedFocus);
    const key = event.name.toLowerCase();
    const emptyWorkspace =
      !overlayKind() &&
      !operation.task() &&
      route.snapshot().destination === "workspace" &&
      workspaceState.section() === "skills" &&
      (projection.workspace()?.installedSkills.length ?? 0) === 0 &&
      !workspaceState.sourceFilter() &&
      renderer.currentFocusedRenderable?.id === "empty-workspace-action";
    if (emptyWorkspace && (key === "enter" || key === "return")) {
      void dispatchAction("add-source");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (overlayKind() === "filter" && ["enter", "return"].includes(event.name.toLowerCase())) {
      const target = skillsFilterPayload()?.dimension
        ? "skills-filter-values"
        : "skills-filter-dimensions";
      if (renderer.currentFocusedRenderable?.id === "skills-filter-search") {
        renderer.root.findDescendantById(target)?.focus();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (overlayKind() === "filter" && event.name.toLowerCase() === "tab") {
      const order = [
        "skills-filter-search",
        skillsFilterPayload()?.dimension ? "skills-filter-values" : "skills-filter-dimensions",
        "skills-filter-clear-all",
      ];
      const index = order.indexOf(renderer.currentFocusedRenderable?.id ?? "");
      const next = order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!;
      renderer.root.findDescendantById(next)?.focus();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const facts = { ...navigationFacts(), focus: observedFocus };
    const readerActive = facts.readerActive;
    const collectionsActive =
      route.snapshot().destination === "workspace" && workspaceState.section() === "collections";
    const collectionFilter = collectionsState.filter();
    if (collectionsActive && collectionFilter.open) {
      const select = collectionFilter.dimension
        ? "collections-filter-values"
        : "collections-filter-dimensions";
      if (event.name.toLowerCase() === "tab") {
        const order = ["collections-filter-search", select];
        const index = order.indexOf(renderer.currentFocusedRenderable?.id ?? "");
        const next = order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!;
        requestFocus(
          next === "collections-filter-search"
            ? "collections-filter-search"
            : collectionFilter.dimension
              ? "collections-filter-values"
              : "collections-filter-dimensions",
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        ["enter", "return"].includes(event.name.toLowerCase()) &&
        renderer.currentFocusedRenderable?.id === "collections-filter-search"
      ) {
        requestFocus(
          collectionFilter.dimension
            ? "collections-filter-values"
            : "collections-filter-dimensions",
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (
      readerActive &&
      focus.desired() === "reader" &&
      ["pageup", "pagedown", "home", "end"].includes(event.name.toLowerCase())
    )
      queueMicrotask(() => {
        const scrollbox = renderer.root.findDescendantById(
          reader()?.tab === "details" ? "reader-details" : "reader-scrollbox",
        );
        if (scrollbox && "scrollTop" in scrollbox && Number(scrollbox.scrollTop) > 0)
          readerDispatch({
            type: "patch",
            value:
              reader()?.tab === "details"
                ? { detailsScroll: Number(scrollbox.scrollTop) }
                : { scroll: Number(scrollbox.scrollTop) },
          });
      });
    if (!applyNavigation(resolve(facts, parseNavKey(event)))) return;
    event.preventDefault();
    event.stopPropagation();
  });
  onMount(() => {
    resize(renderer.width, renderer.height);
    void effects.refresh().then(() => {
      const selected = workspaceState.selectedSkill();
      const address = projection
        .workspace()
        ?.installedSkills.find(
          (item) => `${item.address.source}/${item.address.path}` === selected,
        )?.address;
      if (address) selectReaderSkill(address);
    });
  });
  createEffect(() => {
    focusVersion();
    readerFocusUnblocked();
    const owner = focusOwner();
    const revision = ++focusReconciliationRevision;
    if (appliedFocusOwner !== owner) {
      appliedFocusOwner = undefined;
      appliedFocusTarget = undefined;
    }
    if (
      !overlayKind() &&
      !operation.task() &&
      owner === "browser" &&
      !renderer.currentFocusedRenderable
    ) {
      const target = focusRegistry.target(owner);
      if (
        target &&
        !(
          appliedFocusOwner === owner &&
          appliedFocusTarget === target &&
          renderer.currentFocusedRenderable === target
        )
      ) {
        target.focus();
        appliedFocusOwner = owner;
        appliedFocusTarget = target;
      }
      return;
    }
    queueMicrotask(() => {
      if (focusReconciliationRevision !== revision) return;
      if (focus.desired() !== owner) return;
      if (overlayKind() || operation.task()) return;
      if (!owner) return;
      const target = focusRegistry.target(owner);
      if (
        !target ||
        (appliedFocusOwner === owner &&
          appliedFocusTarget === target &&
          renderer.currentFocusedRenderable === target)
      )
        return;
      target.focus();
      appliedFocusOwner = owner;
      appliedFocusTarget = target;
    });
  });
  createEffect(() => {
    if (installedPreviewPayload()?.review)
      queueMicrotask(() => renderer.root.findDescendantById("installed-skill-review")?.focus());
    else if (collectionReviewPayload())
      queueMicrotask(() => renderer.root.findDescendantById("collection-review-choice")?.focus());
    else if (installedPreviewPayload()?.failed)
      queueMicrotask(() =>
        renderer.root.findDescendantById("installed-skill-preview-failure")?.focus(),
      );
    else if (installedPreviewPayload())
      queueMicrotask(() =>
        renderer.root.findDescendantById("installed-skill-preview-progress")?.focus(),
      );
  });
  const resize = (width: number, height: number) =>
    layout.resize(width, height, (wasNarrow) => {
      const desired = focus.desired() ?? "browser";
      const readerFocus =
        route.snapshot().destination === "workspace" &&
        workspaceState.section() === "skills" &&
        readerOwnsFocus(desired);
      const remountReader =
        wasNarrow &&
        !layout.narrow() &&
        route.snapshot().destination === "workspace" &&
        workspaceState.section() === "skills" &&
        readerOwnsFocus(reader()?.focus ?? "reader-tabs");
      if (layout.narrow() && readerFocus) {
        workspaceState.showList();
        requestFocus("browser");
      } else if (remountReader) requestFocus(reader()?.focus ?? "reader-tabs");
    });
  onResize(resize);
  onCleanup(() => {
    focusReconciliationRevision += 1;
    configFocusRevision += 1;
    if (pendingConfigFocus) renderer.off("frame", pendingConfigFocus.listener);
    pendingConfigFocus = undefined;
    renderer.off("focused_renderable", syncPhysicalFocus);
    renderer.keyInput.off("keypress", interceptPriorityKey);
    stopThemeFollow();
    stopFocusSubscription();
    effects.teardown();
  });
  const actions = () =>
    reachableActions(route.snapshot().destination, projection.workspace(), {
      workspace: workspaceState.snapshot(),
      collections: collectionsState.snapshot(),
      config: (destination) => configState.snapshot(destination),
    });
  const sectionTitle = (section: Section): string =>
    section === "config-sources"
      ? "Config Sources"
      : section === "for-agents"
        ? "For agents"
        : section[0]!.toUpperCase() + section.slice(1);
  const contextLine = () => {
    const destination = route.snapshot().destination;
    const title = sectionTitle(
      destination === "workspace" ? workspaceState.section() : configState.section(destination),
    );
    const context =
      destination === "workspace"
        ? `Workspace › ${title}`
        : `${destination[0]!.toUpperCase()}${destination.slice(1)} Config › ${title}`;
    return layout.narrow()
      ? context
      : `${context} · ${projection.workspace()?.project.root ?? "Loading"}`;
  };
  const helpLine = () =>
    layout.narrow()
      ? "←/→ nav Tab focus Enter open Ctrl+P Esc"
      : "←/→ sections · Tab focus · Enter open · Ctrl+P palette · Esc back";
  const selectDestination = (destination: Destination, focus?: FocusOwner) => {
    route.destinationSelect(destination, focus);
  };
  const configDestination = () => {
    const destination = route.snapshot().destination;
    return destination === "workspace" ? "global" : destination;
  };
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="row" height={1}>
        {!layout.narrow() && <text>skill-cli </text>}
        <SectionTabs
          id="top-navigation"
          options={topOptions}
          value={route.snapshot().destination}
          owner="top-nav"
          focusRegistry={focusRegistry}
          compact={layout.narrow()}
          onPrimaryPointerEntry={() => requestFocus("top-nav")}
          onNavigate={(destination) => selectDestination(destination, "top-nav")}
        />
      </box>
      <text height={1}>{contextLine()}</text>
      <box flexGrow={1}>
        {layout.tooSmall() ? (
          <text>Terminal is too small.</text>
        ) : (
          <Show
            when={route.snapshot().destination === "workspace"}
            fallback={
              <ConfigPage
                config={configState}
                overlay={() => !!overlayKind()}
                narrow={layout.narrow()}
                handoff={route.snapshot().handoff}
                projection={projection.workspace}
                focusRegistry={focusRegistry}
                destination={configDestination()}
                actions={actions()}
                onSelect={(source) => configState.select(configDestination(), source)}
                onActions={() => {
                  if (!overlayKind()) void dispatchAction("open-actions");
                }}
                onAction={(id) => void dispatchAction(id)}
                onSection={(section) => {
                  const destination = configDestination();
                  configFocusRevision += 1;
                  if (pendingConfigFocus) renderer.off("frame", pendingConfigFocus.listener);
                  configState.selectSection(destination, section);
                  requestFocus("local-nav");
                  const revision = configFocusRevision;
                  const listener = () => {
                    if (pendingConfigFocus?.revision !== revision) return;
                    pendingConfigFocus = undefined;
                    if (
                      route.snapshot().destination !== destination ||
                      configState.section(destination) !== section ||
                      focus.desired() !== "local-nav"
                    )
                      return;
                    focusRegistry.applyFocus("local-nav");
                  };
                  pendingConfigFocus = {
                    revision,
                    destination,
                    section,
                    listener,
                  };
                  renderer.once("frame", listener);
                }}
                onLocalNavFocus={() => requestFocus("local-nav")}
                onContribution={(contribution) => {
                  if (contribution.kind === "source")
                    route.contribution(
                      {
                        destination: contribution.owner.level,
                        section: "sources",
                        selection: contribution.source.id,
                        handoff: {
                          kind: "source-contribution",
                          source: contribution.source,
                          owner: contribution.owner,
                        },
                      },
                      {
                        destination: configDestination(),
                        section: "config-sources",
                        selection: contribution.owner.pointer,
                      },
                    );
                  else
                    route.contribution(
                      {
                        destination: contribution.owner.level,
                        section: "collections",
                        selection: contribution.collection,
                      },
                      {
                        destination: configDestination(),
                        section: "config-sources",
                        selection: configState.selection(configDestination(), "config-sources"),
                      },
                    );
                }}
              />
            }
          >
            <WorkspacePage
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
              narrow={layout.narrow()}
              narrowLevel={workspaceState.narrowLevel()}
              handoff={route.snapshot().handoff}
              projection={projection.workspace}
              focusRegistry={focusRegistry}
              actions={actions()}
              onSelectSource={(source) => {
                if (!overlayKind()) workspaceState.selectSource(source);
              }}
              onSkill={(address, intent) => {
                if (intent === "open") openReaderSkill(address);
                else
                  batch(() => {
                    workspaceState.selectSkill(`${address.source}/${address.path}`);
                    selectReaderSkill(address);
                  });
              }}
              onActions={() => {
                if (!overlayKind()) void dispatchAction("open-actions");
              }}
              onFirstSkill={() => void dispatchAction("add-source")}
              onDetail={() => {
                const value = reader();
                workspaceState.openDetail();
                requestFocus(
                  workspaceState.section() === "sources"
                    ? "local-nav"
                    : value?.tab === "resources"
                      ? value.resourceLevel === "content"
                        ? "reader-resource-content"
                        : "reader-resource-list"
                      : value?.tab === "details" &&
                          (value.focus === "inspector" || value.focus === "details-relationships")
                        ? value.focus
                        : "reader",
                );
              }}
              onClearSourceFilter={() => {
                workspaceState.clearSourceFilter();
              }}
              onQuery={(query) => {
                workspaceState.setQuery(query);
                const workspace = projection.workspace();
                if (workspace) workspaceState.reconcile(workspace, workspace);
              }}
              onOpenFilter={() => {
                openSession("filter", { family: "skills-filter", search: "" });
              }}
              onClearFilter={(dimension) => {
                workspaceState.clearFilter(dimension);
                const workspace = projection.workspace();
                if (workspace) workspaceState.reconcile(workspace, workspace);
                const remaining = Object.keys(workspaceState.filters()).filter(
                  (item) => item !== dimension,
                );
                const focus: FocusOwner = remaining.length
                  ? "skills-filter-clear"
                  : workspaceState.query()
                    ? "skills-filter-clear-all"
                    : "browser";
                requestFocus(focus);
              }}
              onClearAllFilters={() => {
                workspaceState.clearFilters();
                if (projection.workspace())
                  workspaceState.reconcile(projection.workspace()!, projection.workspace()!);
                requestFocus("browser");
              }}
              onSelectCollection={(collection) => {
                collectionsState.select(collection);
              }}
              onCollectionQuery={(query) => {
                collectionsState.setQuery(query);
                const workspace = projection.workspace();
                if (workspace) collectionsState.reconcile(workspace, workspace);
              }}
              onCollectionFilter={(dimension, value) => {
                collectionsState.setFilter(dimension, value);
                const workspace = projection.workspace();
                if (workspace) collectionsState.reconcile(workspace, workspace);
              }}
              onClearCollectionFilter={(dimension) => {
                let focus: FocusOwner = "browser";
                collectionsState.clearFilter(dimension);
                const workspace = projection.workspace();
                if (workspace) collectionsState.reconcile(workspace, workspace);
                const remaining = Object.keys(collectionsState.filters()).filter(
                  (item) => item !== dimension,
                );
                focus = remaining.length
                  ? "collections-filter-clear"
                  : collectionsState.query()
                    ? "collections-filter-clear-all"
                    : "browser";
                requestFocus(focus);
              }}
              onClearAllCollectionFilters={() => {
                collectionsState.clearFilters();
                if (projection.workspace())
                  collectionsState.reconcile(projection.workspace()!, projection.workspace()!);
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
                requestFocus("inspector");
              }}
              onCollectionDetail={() => {
                workspaceState.openDetail();
                requestFocus("inspector");
              }}
              onCollectionRelationship={(intent: CollectionRelationshipIntent) => {
                if (intent.kind === "collection-producer") {
                  routeSource({
                    destination: "workspace",
                    section: "skills",
                    selection: `${intent.address.source}/${intent.address.path}`,
                    handoff: {
                      kind: "agent-producer",
                      address: intent.address,
                    },
                  });
                  return;
                }
                if (intent.kind === "collection-direct") {
                  void previewMembershipRemoval({
                    kind: "membership-removal",
                    level: intent.owner.level,
                    collection: intent.collection,
                    name: intent.name,
                    expectedAddress: intent.address,
                  });
                  return;
                }
                if (intent.kind === "collection-reference" && !intent.owner.contribution) {
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
              onSection={(section) => {
                workspaceState.selectSection(section);
                requestFocus("local-nav");
              }}
              onLocalNavFocus={() => requestFocus("local-nav")}
              onInspectorFocus={() => requestFocus("inspector")}
              onReaderPatch={(reader) => {
                if (reader.raw === true) requestFocus("reader-raw");
                if (reader.tab) selectReaderTab(reader.tab);
                else readerDispatch({ type: "patch", value: reader });
              }}
              onReaderFindCommit={(value) => {
                const current = reader();
                readerDispatch({
                  type: "patch",
                  value: {
                    find: value,
                    match: current?.find === value ? current.match : 0,
                  },
                });
              }}
              onResources={() => ensureResources()}
              onReadResource={(address, path) => {
                requestFocus("reader-resource-content");
                void effects.readResource(address, path);
              }}
              onRetryResource={(address) => {
                const current = reader();
                if (current?.resourceLevel === "content" && current.selectedResource) {
                  requestFocus("reader-resource-content");
                  void effects.readResource(address, current.selectedResource);
                } else {
                  requestFocus("reader-resource-list");
                  void effects.listResources(address);
                }
              }}
              onResourceBack={() => (
                requestFocus("reader-resource-list"),
                readerDispatch({
                  type: "patch",
                  value: {
                    resourceLevel: "list",
                    resource: undefined,
                    resourceLoading: false,
                    error: undefined,
                  },
                })
              )}
              onDetailsActions={() => {
                if (!overlayKind()) void dispatchAction("open-actions");
              }}
              onDetailsRelationship={(relationship) => {
                const workspace = projection.workspace();
                const skill = installedSkillContext(route.snapshot().destination, workspace, {
                  workspace: workspaceState.snapshot(),
                  collections: collectionsState.snapshot(),
                  config: (destination) => configState.snapshot(destination),
                })?.skill;
                if (!skill?.source) return;
                if (relationship === "source") {
                  const owner = workspace?.configs
                    .flatMap((config) => config.direct.sources)
                    .find((source) => source.id === skill.source!.id)?.ref.owner;
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
                      returnFocus: "details-relationships",
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
                      returnFocus: "details-relationships",
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
                    returnFocus: "details-relationships",
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
                      returnFocus: "details-relationships",
                    });
                } else if (relationship === "selectors") void dispatchAction("skill-for-agents");
              }}
              onDetailsScroll={(scroll) =>
                readerDispatch({
                  type: "patch",
                  value: { detailsScroll: scroll },
                })
              }
            />
          </Show>
        )}
      </box>
      <text height={1}>{helpLine()}</text>
      <text height={1}>
        {operation.task()?.cancellationRequested
          ? "Cancelling operation"
          : (operation.notice() ?? "Loading workspace")}
      </text>
      {(overlayKind() === "actions" || overlayKind() === "palette") && (
        <ActionOverlay
          title={overlayKind() === "actions" ? "Actions" : "Palette"}
          actions={actions()}
          onSelect={(id) => {
            if (isDestination(id)) {
              selectDestination(id);
              closeSession();
              return;
            }
            if (id === "open-actions" || id === "open-palette") return;
            void dispatchAction(id);
          }}
          onClose={closeOverlay}
        />
      )}
      {overlayKind() === "filter" && (
        <>
          <box
            id="skills-filter-underlay"
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
          <box
            id="skills-filter-overlay"
            position="absolute"
            top={2}
            left={2}
            width="70%"
            border
            flexDirection="column"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <text>Filter Skills</text>
            {!filterDimension() ? (
              <box flexDirection="column">
                <FilterSearch />
                <box position="relative" flexDirection="column">
                  <select
                    id="skills-filter-dimensions"
                    focused={false}
                    options={filterDimensions("skills")
                      .filter((dimension) =>
                        dimension.toLocaleLowerCase().includes(filterSearch().toLocaleLowerCase()),
                      )
                      .map((dimension) => ({
                        name: `${dimension}  ${workspaceState.filters()[dimension] ?? "Any"}`,
                        description: "Choose filter value",
                        value: dimension,
                      }))}
                    showDescription={false}
                    onSelect={(_index, option) => {
                      if (typeof option?.value === "string") selectFilterDimension(option.value);
                    }}
                  />
                  {filterDimensions("skills")
                    .filter((dimension) =>
                      dimension.toLocaleLowerCase().includes(filterSearch().toLocaleLowerCase()),
                    )
                    .map((dimension, index) => (
                      <box
                        id={`skills-filter-dimension-${encodeURIComponent(dimension)}`}
                        position="absolute"
                        top={index}
                        left={0}
                        width="100%"
                        height={1}
                        onMouseDown={(event) => {
                          selectFilterDimension(dimension);
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      />
                    ))}
                </box>
              </box>
            ) : (
              <box flexDirection="column">
                <FilterSearch />
                <box position="relative" flexDirection="column">
                  <select
                    id="skills-filter-values"
                    focused={false}
                    options={[
                      {
                        name: "Any",
                        description: "Clear this filter",
                        value: "",
                      },
                      ...filterValues(
                        projection.workspace()?.installedSkills ?? [],
                        filterDimension()!,
                        projection.workspace()?.effective.agent.status,
                      )
                        .filter((value) =>
                          value.toLocaleLowerCase().includes(filterSearch().toLocaleLowerCase()),
                        )
                        .map((value) => ({
                          name: value,
                          description: "Filter value",
                          value,
                        })),
                    ]}
                    showDescription={false}
                    onSelect={(_index, option) => {
                      const dimension = filterDimension();
                      if (dimension && typeof option?.value === "string")
                        selectFilterValue(dimension, option.value);
                    }}
                  />
                  {[
                    "",
                    ...filterValues(
                      projection.workspace()?.installedSkills ?? [],
                      filterDimension()!,
                      projection.workspace()?.effective.agent.status,
                    ).filter((value) =>
                      value.toLocaleLowerCase().includes(filterSearch().toLocaleLowerCase()),
                    ),
                  ].map((value, index) => {
                    const dimension = filterDimension()!;
                    return (
                      <box
                        id={`skills-filter-value-${encodeURIComponent(dimension)}-${value ? encodeURIComponent(value) : "any"}`}
                        position="absolute"
                        top={index}
                        left={0}
                        width="100%"
                        height={1}
                        onMouseDown={(event) => {
                          selectFilterValue(dimension, value);
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      />
                    );
                  })}
                </box>
              </box>
            )}
            <select
              id="skills-filter-clear-all"
              focused={false}
              options={[
                {
                  name: "Clear all",
                  description: "Clear query and local filters",
                  value: "clear",
                },
              ]}
              showDescription={false}
              onSelect={() => {
                setSessionPayload({ family: "skills-filter", search: "" });
                workspaceState.clearFilters();
              }}
            />
          </box>
        </>
      )}
      {installedAgentViewsPayload() && (
        <AgentPathsOverlay
          views={installedAgentViewsPayload()!.views}
          onClose={closeOverlay}
          onSelect={(value) => {
            const [kind, selectorIndex, pathIndex, linkIndex] = value.split(":");
            const views = installedAgentViewsPayload()?.views;
            const view =
              views?.status === "complete" ? views.values[Number(selectorIndex)] : undefined;
            if (!view) return;
            if (kind === "path") {
              const path = view.paths[Number(pathIndex)];
              if (path?.kind === "direct") {
                const owner = path.owner;
                if (owner)
                  routeRelationship({
                    destination: owner.contribution
                      ? owner.contribution.configSource.level
                      : owner.level,
                    section: owner.contribution ? "config-sources" : "collections",
                    selection: owner.contribution
                      ? owner.contribution.configSource.pointer
                      : path.collection,
                    returnFocus: "inspector",
                    handoff: {
                      kind: "agent-membership",
                      collection: path.collection,
                      entry: path.entryName,
                      owner,
                    },
                  });
              } else if (path?.kind === "repository-derived") {
                routeSource({
                  destination: "workspace",
                  section: "skills",
                  selection: `${path.source}/${path.path}`,
                  handoff: {
                    kind: "agent-producer",
                    address: { source: path.source, path: path.path },
                  },
                });
              }
            } else if (kind === "link") {
              const path = view.paths[Number(pathIndex)];
              if (path?.kind === "via-link") {
                const link = path.links[Number(linkIndex)];
                const owner = link?.owner;
                if (owner)
                  routeRelationship({
                    destination: owner.contribution
                      ? owner.contribution.configSource.level
                      : owner.level,
                    section: owner.contribution ? "config-sources" : "collections",
                    selection: owner.contribution
                      ? owner.contribution.configSource.pointer
                      : link.collection,
                    returnFocus: "inspector",
                    handoff: {
                      kind: "agent-link",
                      collection: link.collection,
                      linkedCollection: link.linkedCollection,
                      owner,
                    },
                  });
              }
            } else if (kind === "use") {
              const owner = view.useOwners[Number(pathIndex)];
              if (owner)
                routeSource({
                  destination: owner.level,
                  section: "for-agents",
                  selection: view.collection,
                  handoff: {
                    kind: "agent-use",
                    collection: view.collection,
                    owner,
                  },
                });
            }
            closeSession();
            requestFocus("browser");
          }}
        />
      )}
      {installedRebindPayload() && (
        <RebindSourceOverlay
          sources={installedRebindPayload()!.sources}
          onClose={closeOverlay}
          onSelect={(owner, ownerPath) => {
            const surface = installedRebindPayload()!;
            const skill = installedSkillContext(
              route.snapshot().destination,
              projection.workspace(),
              {
                workspace: workspaceState.snapshot(),
                collections: collectionsState.snapshot(),
                config: (destination) => configState.snapshot(destination),
              },
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
            const skill = installedSkillContext(
              route.snapshot().destination,
              projection.workspace(),
              {
                workspace: workspaceState.snapshot(),
                collections: collectionsState.snapshot(),
                config: (destination) => configState.snapshot(destination),
              },
            )?.skill;
            if (!skill) return;
            openSession("confirm", { family: "collection-review" });
            void previewMembership({
              kind: "add-to-collection",
              level: choice.level ?? "project",
              collection: choice.collection,
              address: skill.address,
              name: skill.name,
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
              collection=""
              pending={overlaySession().phase === "executing"}
              error={operation.problem()}
              onCancel={closeOverlay}
              onSubmit={(intent) => {
                const begun = beginSession(overlaySession().revision, "executing");
                void effects
                  .createCollection({ kind: "collection-create", ...intent })
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
                        openSession("confirm", { family: "collection-review" });
                        void previewMembership({
                          kind: "add-to-collection",
                          level: intent.level,
                          collection: afterCreate.collection,
                          address: afterCreate.address,
                          name: afterCreate.address.path.split("/").at(-1) ?? "skill",
                        });
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
              address,
              initialName: name,
            });
          }}
        />
      )}
      {overlayKind() === "form" && membershipDraft() && (
        <MembershipAddOverlay
          level={membershipDraft()!.level}
          collection={membershipDraft()!.collection}
          address={membershipDraft()!.address}
          initialName={membershipDraft()!.initialName}
          pending={overlaySession().phase === "preview"}
          error={operation.problem()}
          onCancel={closeOverlay}
          onPreview={(intent) => {
            void previewMembership(intent, "form");
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
                type: registration.kind === "source" ? "source.register" : "config-source.register",
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
                  const section = registration.kind === "source" ? "sources" : "config-sources";
                  batch(() => {
                    closeSession(begun.revision);
                    routeSource({
                      destination: value.level,
                      section,
                      selection:
                        registration.kind === "source" ? value.id : `/configSources/${value.id}`,
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
      {collectionDraft()?.kind === "collection-import" &&
        (() => {
          const draft = collectionDraft()! as Extract<
            import("./effects").CollectionIntent,
            { readonly kind: "collection-import" }
          >;
          return (
            <CollectionImportOverlay
              level={draft.level}
              from={draft.from}
              into={draft.into}
              pending={overlaySession().phase === "preview"}
              error={operation.problem()}
              onCancel={closeOverlay}
              onPreview={(intent) =>
                void previewCollectionDraft(
                  () => effects.previewImport(intent),
                  "collection-import",
                )
              }
            />
          );
        })()}
      {collectionDraft()?.kind === "reference" &&
        (() => {
          const draft = collectionDraft()! as Extract<
            import("./effects").CollectionIntent,
            { readonly kind: "reference" }
          >;
          return (
            <ReferenceOverlay
              level={draft.level}
              collection={draft.collection}
              name={draft.name}
              target={draft.target}
              description={draft.description}
              remove={draft.remove ?? false}
              pending={overlaySession().phase === "preview"}
              error={operation.problem()}
              onCancel={closeOverlay}
              onPreview={(intent) =>
                void previewCollectionDraft(() => effects.previewReference(intent), "reference")
              }
            />
          );
        })()}
      {collectionDraft()?.kind === "link-change" &&
        (() => {
          const draft = collectionDraft()! as Extract<
            import("./effects").CollectionIntent,
            { readonly kind: "link-change" }
          >;
          return (
            <LinkChangeOverlay
              level={draft.level}
              collection={draft.collection}
              target={draft.target}
              linked={draft.linked}
              pending={overlaySession().phase === "preview"}
              error={operation.problem()}
              onCancel={closeOverlay}
              onPreview={(intent) =>
                void previewCollectionDraft(() => effects.previewLinkChange(intent), "link-change")
              }
            />
          );
        })()}
      {collectionDraft()?.kind === "collection-use" &&
        (() => {
          const draft = collectionDraft()! as Extract<
            import("./effects").CollectionIntent,
            { readonly kind: "collection-use" }
          >;
          return (
            <CollectionUseOverlay
              level={draft.level}
              collections={draft.collections}
              pending={overlaySession().phase === "preview"}
              error={operation.problem()}
              onCancel={closeOverlay}
              onPreview={(intent) =>
                void previewCollectionDraft(
                  () => effects.previewCollectionUse(intent),
                  "collection-use",
                )
              }
            />
          );
        })()}
      {overlayKind() === "confirm" && collectionReview() && (
        <CollectionReviewOverlay
          review={collectionReview()!}
          pending={overlaySession().phase === "executing"}
          error={operation.problem()}
          onCancel={closeOverlay}
          onConfirm={() =>
            collectionReview()!.kind === "add-to-collection"
              ? void applyMembership()
              : void applyCollectionReview()
          }
        />
      )}
      {configOperation() && (
        <box
          position="absolute"
          left={0}
          top={0}
          width="100%"
          height="100%"
          backgroundColor="#111111"
        >
          <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
            <text>
              {configOperation()!.kind === "managed"
                ? `${configOperation()!.enabled ? "Enable" : "Disable"} Managed OpenCode`
                : `${configOperation()!.kind[0]!.toUpperCase()}${configOperation()!.kind.slice(1)} Config Source`}
            </text>
            <text>
              {configOperation()!.kind === "managed"
                ? `Config level: ${configOperation()!.level}`
                : `Config Source: ${configOperation()!.id}`}
            </text>
            {configOperation()!.kind === "adopt" && (
              <text>{`Exact revision: ${configOperation()!.observation?.exactRevision}`}</text>
            )}
            {configOperation()!.impact && (
              <>
                <text>{`Owner: ${configOperation()!.impact!.owner.file} ${configOperation()!.impact!.owner.pointer}`}</text>
                <text>{`Binding: ${configBindingLine(configOperation()!.impact!.binding)}`}</text>
                {configOperation()!.impact!.currentAppliedCommit && (
                  <text>{`Applied commit: ${configOperation()!.impact!.currentAppliedCommit}`}</text>
                )}
                {configOperation()!.impact!.exactRevision && (
                  <text>{`Reviewed commit: ${configOperation()!.impact!.exactRevision}`}</text>
                )}
                {configOperation()!.impact!.delta.addedSources.map((item) => (
                  <text>{`Added Source: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                ))}
                {configOperation()!.impact!.delta.changedSources.map((item) => (
                  <text>{`Changed Source: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                ))}
                {configOperation()!.impact!.delta.removedSources.map((item) => (
                  <text>{`Removed Source: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                ))}
                {configOperation()!.impact!.delta.addedCollections.map((item) => (
                  <text>{`Added Collection: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                ))}
                {configOperation()!.impact!.delta.changedCollections.map((item) => (
                  <text>{`Changed Collection: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                ))}
                {configOperation()!.impact!.delta.removedCollections.map((item) => (
                  <text>{`Removed Collection: ${item.id} (${item.owner.file} ${item.owner.pointer})`}</text>
                ))}
                {configOperation()!.impact!.affectedInstalled.map((item) => (
                  <text>{`Affected Installed Skill: ${item.source}/${item.path}`}</text>
                ))}
                {configOperation()!.impact!.disappearingSelectors.map((item) => (
                  <text>{`Disappears: ${item}`}</text>
                ))}
                {configOperation()!.impact!.blockers.map((item) => (
                  <text>{`Blocker: ${item.reason}`}</text>
                ))}
                {!configOperation()!.impact!.allowed && (
                  <text>Operation is blocked by current dependencies.</text>
                )}
              </>
            )}
            <select
              id="config-operation-review"
              focused={true}
              selectedIndex={0}
              showDescription={false}
              options={
                configOperation()!.impact && !configOperation()!.impact!.allowed
                  ? [
                      {
                        name: "Cancel",
                        description: "Return without mutation",
                        value: "cancel",
                      },
                    ]
                  : [
                      {
                        name: "Cancel",
                        description: "Keep current configuration",
                        value: "cancel",
                      },
                      {
                        name: overlaySession().phase === "executing" ? "Applying" : "Confirm",
                        description: "Apply reviewed operation",
                        value: "confirm",
                      },
                    ]
              }
              onSelect={(_index, option) => {
                if (option?.value === "cancel") closeOverlay();
                else if (option?.value === "confirm" && overlaySession().phase !== "executing") {
                  const operation = configOperation()!;
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
                          : effects.setManagedOpenCode(operation.level!, operation.enabled!);
                  void execute.then((complete) => {
                    if (complete && sessionMatches(begun, "confirm", "config-operation"))
                      closeSession(begun.revision);
                    else if (
                      sessionMatches(begun, "confirm", "config-operation") &&
                      overlaySession().dismissed
                    )
                      closeSession(begun.revision);
                    else settleFailedExecution(begun);
                  });
                }
              }}
            />
            <text>Cancel is selected by default</text>
          </box>
        </box>
      )}
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
                  workspaceState.selectSkill(`${current.impact.owner}/${current.impact.ownerPath}`);
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
      <Show when={sourceSelectionPayload()}>
        {(selection) => (
          <SourceSelectionOverlay
            review={selection().review}
            installed={
              new Set(
                (projection.workspace()?.installedSkills ?? [])
                  .filter((skill) => skill.address.source === selection().review.observation.source)
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
          title={
            sourceObservationPayload()!.intent.kind === "source-discovery"
              ? "Discovering Skills"
              : "Checking Updates"
          }
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
            void (
              intent.kind === "source-discovery"
                ? effects.discover(intent)
                : effects.checkUpdate(intent)
            ).then((next) => {
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
            backgroundColor="#111111"
          >
            <text>Reviewing Source removal impact. Escape Cancel</text>
          </box>
        )}
    </box>
  );
}

export async function runTui(core: SkillCliCore): Promise<void> {
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    exitOnCtrlC: false,
    useMouse: true,
    consoleMode: "disabled",
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
