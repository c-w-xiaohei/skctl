import { createCliRenderer, InputRenderable, type TabSelectRenderable } from "@opentui/core";
import { onResize, render, useKeyboard, useRenderer } from "@opentui/solid";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type {
  ConfigSourceObservation,
  ConfigSourceImpact,
  InstalledSkillSelectorViews,
  SkillCliCore,
} from "../core/api";
import {
  actionIntent,
  arbitrateKey,
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
  createTuiState,
  destinations,
  findLiteralMatches,
  reduceTui,
  type Destination,
  type FocusOwner,
  type Section,
} from "./model";
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
import { filterDimensions } from "./model";
import { filterSkills, filterValues } from "./skills-filter";
import { filterCollections } from "./collections-filter";
import type { CollectionRelationshipIntent } from "./collections-page";

const topOptions = destinations.map((value) => ({
  name: value === "workspace" ? "Workspace" : value[0]!.toUpperCase() + value.slice(1),
  description: "",
  value,
}));
const isDestination = (value: ActionId | Destination): value is Destination =>
  destinations.some((destination) => destination === value);
const configBindingLine = (binding: ConfigSourceImpact["binding"]) =>
  `${binding.kind} ${binding.kind === "local" ? binding.path : binding.origin} ${binding.root}`;

export function App(props: { readonly core: TuiCore; readonly exit: () => void }) {
  const [state, setState] = createSignal(createTuiState());
  const [review, setReview] = createSignal<SourceRemovalReview>();
  const [sourceReview, setSourceReview] = createSignal<DiscoveryReview | UpdateReview>();
  const [selectedPaths, setSelectedPaths] = createSignal<readonly string[]>([]);
  const [observationIntent, setObservationIntent] =
    createSignal<ReturnType<typeof sourceOperationIntent>>();
  const [repair, setRepair] = createSignal<{
    readonly action: "rebind" | "uninstall";
    readonly source: string;
    readonly path: string;
  }>();
  const [installedReview, setInstalledReview] = createSignal<InstalledSkillReview>();
  const [installedPreviewFailure, setInstalledPreviewFailure] =
    createSignal<InstalledSkillPreviewRequest>();
  const [installedPreview, setInstalledPreview] = createSignal<InstalledSkillPreviewRequest>();
  const [installedPreviewRetrying, setInstalledPreviewRetrying] = createSignal(false);
  const [installedPreviewCancelling, setInstalledPreviewCancelling] = createSignal(false);
  const [agentViews, setAgentViews] = createSignal<InstalledSkillSelectorViews>();
  const [rebindSources, setRebindSources] = createSignal<readonly string[]>();
  const [collectionChoices, setCollectionChoices] = createSignal<
    readonly {
      readonly collection: string;
      readonly level?: "global" | "project" | "local";
    }[]
  >();
  const [collectionCreate, setCollectionCreate] = createSignal<{
    readonly level?: "global" | "project" | "local";
    readonly allowedLevels?: readonly ("global" | "project" | "local")[];
    readonly afterCreate?: {
      readonly collection: string;
      readonly address: { readonly source: string; readonly path: string };
    };
  }>();
  const [membershipDraft, setMembershipDraft] = createSignal<{
    readonly level: "global" | "project" | "local";
    readonly collection: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly initialName: string;
  }>();
  const [membershipChooser, setMembershipChooser] = createSignal<{
    readonly level: "global" | "project" | "local";
    readonly collection: string;
  }>();
  const [collectionReview, setCollectionReview] =
    createSignal<import("./effects").CollectionReview>();
  const [collectionDraft, setCollectionDraft] = createSignal<
    | Extract<
        import("./effects").CollectionIntent,
        { readonly kind: "collection-import" | "reference" | "link-change" | "collection-use" }
      >
    | undefined
  >();
  const [configOperation, setConfigOperation] = createSignal<{
    readonly kind: "adopt" | "forget" | "remove" | "managed";
    readonly id?: string;
    readonly observation?: ConfigSourceObservation;
    readonly impact?: ConfigSourceImpact;
    readonly level?: "global" | "project" | "local";
    readonly enabled?: boolean;
  }>();
  const [sourceRegistration, setSourceRegistration] = createSignal<{
    readonly kind: "source" | "config-source";
    readonly level?: "global" | "project" | "local";
  }>();
  const [filterDimension, setFilterDimension] = createSignal<string>();
  const [filterSearch, setFilterSearch] = createSignal("");
  const renderer = useRenderer();
  const [size, setSize] = createSignal({
    width: renderer.width,
    height: renderer.height,
  });
  const effects = createTuiEffects(props.core, (event) =>
    setState((current) => reduceTui(current, event)),
  );
  const reconcileSkills = (current: ReturnType<typeof state>) => {
    const workspace = current.workspace;
    if (!workspace) return current;
    const memory = current.memory.workspace;
    const values = filterSkills(workspace.installedSkills, {
      query: memory.query.skills,
      filters: memory.filters.skills,
      source: current.sourceFilter,
      agentStatus: workspace.effective.agent.status,
    }).map((skill) => `${skill.address.source}/${skill.address.path}`);
    return reduceTui(current, {
      type: "selection.reconcile",
      key: "skills",
      values,
      previous: workspace.installedSkills.map(
        (skill) => `${skill.address.source}/${skill.address.path}`,
      ),
    });
  };
  const updateSkills = (event: Parameters<typeof reduceTui>[1]) =>
    setState((current) => reconcileSkills(reduceTui(current, event)));
  const reconcileCollections = (current: ReturnType<typeof state>) => {
    if (current.workspace?.effective.status !== "complete") return current;
    const memory = current.memory.workspace;
    const values = filterCollections(current.workspace.effective.collectionsView, {
      query: memory.query.collections,
      filters: memory.filters.collections ?? {},
      agentUse: current.workspace.effective.use,
      installedSkills: current.workspace.installedSkills,
    }).map((collection) => collection.id);
    return reduceTui(current, {
      type: "selection.reconcile",
      key: "collections",
      values,
      previous: current.workspace.effective.collectionsView.map((collection) => collection.id),
    });
  };
  const updateCollections = (event: Parameters<typeof reduceTui>[1]) =>
    setState((current) => reconcileCollections(reduceTui(current, event)));
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
        placeholder={filterDimension() ? "Search values" : "Search dimensions"}
        value={filterSearch()}
        onInput={setFilterSearch}
      />
    );
  };
  const selectFilterDimension = (dimension: string) => {
    setFilterDimension(dimension);
    setFilterSearch("");
  };
  const selectFilterValue = (dimension: string, value: string) => {
    updateSkills({
      type: "filter.set",
      key: "skills",
      dimension,
      value: value || undefined,
    });
    setFilterDimension(undefined);
    setFilterSearch("");
    setState((value) =>
      reduceTui(reduceTui(value, { type: "overlay.close" }), {
        type: "focus.set",
        focus: "browser",
      }),
    );
    queueMicrotask(() => renderer.root.findDescendantById("installed-skill-browser")?.focus());
  };
  let commitReaderFind = () => {};
  let topNavigation: TabSelectRenderable | undefined;
  const flushReaderFind = () => commitReaderFind();
  let previewRequest = 0;
  let installedPreviewRequest = 0;
  const currentInstalledPreview = (request: InstalledSkillPreviewRequest) => {
    const projection = state().workspace;
    const selected = state().memory.workspace.selection.skills;
    const selectedAddress = `${request.address.source}/${request.address.path}`;
    return !!(
      projection &&
      selected === selectedAddress &&
      projection.installedSkills.some(
        (skill) =>
          skill.address.source === request.address.source &&
          skill.address.path === request.address.path,
      ) &&
      (request.kind === "uninstall" ||
        projection.effective.sources.some(
          (source) => source.id === request.owner && source.id !== request.address.source,
        ))
    );
  };
  const previewInstalled = async (request: InstalledSkillPreviewRequest) => {
    if (effects.pending()) return;
    if (!currentInstalledPreview(request)) {
      setState((value) =>
        reduceTui(value, {
          type: "operation.failure",
          diagnostic: {
            code: "TRANSACTION_CONFLICT",
            severity: "warning",
            message: "Installed Skill preview no longer matches the current selection",
          },
        }),
      );
      return;
    }
    const sequence = ++installedPreviewRequest;
    setInstalledPreview(request);
    setInstalledPreviewFailure(undefined);
    setInstalledPreviewRetrying(true);
    setInstalledPreviewCancelling(false);
    setState((value) => reduceTui(value, { type: "operation.failure.clear" }));
    const next = await effects.reviewInstalled(request);
    if (sequence === installedPreviewRequest && state().overlay === "confirm") {
      if (installedPreviewCancelling()) {
        setInstalledPreview(undefined);
        setState((value) => reduceTui(value, { type: "overlay.close" }));
      } else if (next) {
        setInstalledPreview(undefined);
        setInstalledPreviewFailure(undefined);
        setInstalledReview(next);
      } else {
        setInstalledPreview(undefined);
        setInstalledPreviewFailure(request);
      }
    }
    if (sequence === installedPreviewRequest) {
      setInstalledPreviewRetrying(false);
      setInstalledPreviewCancelling(false);
    }
  };
  const closeOverlay = () => {
    flushReaderFind();
    const current = review();
    if (installedPreview()) {
      if (effects.pendingKind() === "preview") {
        effects.cancel();
        setInstalledPreviewCancelling(true);
        return;
      }
    } else if (installedPreviewFailure()) {
      if (effects.pendingKind() === "preview") {
        effects.cancel();
        setInstalledPreviewCancelling(true);
        return;
      }
      installedPreviewRequest++;
      setInstalledPreviewFailure(undefined);
      setInstalledPreviewRetrying(false);
      setInstalledPreviewCancelling(false);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (effects.pendingKind() === "preview") {
      previewRequest++;
      effects.cancel();
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (state().overlay === "selection" && effects.pendingKind() === "observe") {
      effects.cancel();
      return;
    } else if (state().task) effects.cancel();
    else if (sourceReview()) {
      const active = sourceReview()!;
      if (effects.pendingKind() === "execute") {
        effects.cancel();
        return;
      }
      if (effects.pendingKind() === "observe") effects.cancel();
      else if (active.kind === "discovery") effects.discardDiscovery(active);
      else effects.discardUpdate(active);
      setSourceReview(undefined);
      setSelectedPaths([]);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (installedReview()) {
      effects.discardInstalledReview(installedReview()!);
      setInstalledReview(undefined);
      if (!repair()) setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (agentViews()) {
      setAgentViews(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (rebindSources()) {
      setRebindSources(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (collectionChoices()) {
      setCollectionChoices(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (repair()) {
      setRepair(undefined);
    } else if (configOperation()) {
      setConfigOperation(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (sourceRegistration()) {
      setSourceRegistration(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (collectionCreate()) {
      if (effects.pendingKind() === "execute") {
        effects.cancel();
        return;
      }
      setCollectionCreate(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (membershipDraft()) {
      if (effects.pendingKind() === "preview") {
        effects.cancel();
        return;
      }
      setMembershipDraft(undefined);
      if (collectionReview()) effects.discardCollectionReview(collectionReview()!);
      setCollectionReview(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (collectionDraft()) {
      if (effects.pendingKind() === "preview" || effects.pendingKind() === "execute") {
        effects.cancel();
        return;
      }
      setCollectionDraft(undefined);
      if (collectionReview()) effects.discardCollectionReview(collectionReview()!);
      setCollectionReview(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (collectionReview()) {
      if (effects.pendingKind() === "execute") {
        effects.cancel();
        return;
      }
      effects.discardCollectionReview(collectionReview()!);
      setCollectionReview(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    } else if (!state().overlay && state().sourceFilter)
      setState((value) =>
        reduceTui(reduceTui(value, { type: "source.filter.set", source: undefined }), {
          type: "section.select",
          section: "sources",
        }),
      );
    else if (
      !state().overlay &&
      state().reader.tab === "resources" &&
      state().reader.resourceLevel === "content"
    )
      setState((value) =>
        reduceTui(value, {
          type: "reader.patch",
          value: { resourceLevel: "list", resource: undefined, loading: false, error: undefined },
        }),
      );
    else if (
      !state().overlay &&
      state().destination === "workspace" &&
      state().memory.workspace.section === "skills" &&
      [
        "reader",
        "reader-tabs",
        "input",
        "reader-raw",
        "reader-find-previous",
        "reader-find-next",
        "open-match-raw",
      ].includes(state().focus)
    )
      setState((value) =>
        reduceTui(reduceTui(value, { type: "narrow.level", level: "list" }), {
          type: "focus.set",
          focus: "browser",
        }),
      );
    else if (!state().overlay && size().width < 80 && state().narrowLevel !== "list")
      setState((value) =>
        reduceTui(reduceTui(value, { type: "narrow.level", level: "list" }), {
          type: "focus.set",
          focus: "browser",
        }),
      );
    else {
      if (current) effects.discardReview(current);
      setReview(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    }
  };
  const dispatchAction = async (id: ActionId) => {
    const projection = state().workspace;
    if (!projection) return;
    if (id === "open-actions" || id === "open-palette") {
      setState((value) =>
        reduceTui(value, {
          type: "overlay.open",
          overlay: id === "open-actions" ? "actions" : "palette",
        }),
      );
      return;
    }
    const descriptor = reachableActions(state(), projection).find((action) => action.id === id);
    if (!descriptor?.enabled) {
      if (descriptor?.reason)
        setState((value) =>
          reduceTui(value, {
            type: "operation.failure",
            diagnostic: {
              code: "INVALID_ARGUMENT",
              severity: "warning",
              message: descriptor.reason!,
            },
          }),
        );
      return;
    }
    if (id === "remove-source") {
      const request = ++previewRequest;
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
      const next = await effects.review(actionIntent(id, state(), projection));
      if (next && request === previewRequest && state().overlay === "confirm") {
        setReview(next);
        setRepair(undefined);
        setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
      } else if (request === previewRequest && state().overlay === "confirm" && !review())
        setState((value) => reduceTui(value, { type: "overlay.close" }));
      return;
    }
    if (id === "new-collection") {
      const destination = state().destination;
      setCollectionCreate(
        destination === "workspace"
          ? { allowedLevels: ["global", "project", "local"] }
          : { level: destination },
      );
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "form" }));
      return;
    }
    if (id === "add-source" || id === "add-config-source") {
      const destination = state().destination;
      setSourceRegistration({
        kind: id === "add-source" ? "source" : "config-source",
        ...(destination === "workspace" ? {} : { level: destination }),
      });
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "form" }));
      return;
    }
    if (id === "config-observe") {
      const config = projection.configs.find((item) => item.level === state().destination);
      const source = config?.direct.configSources.find(
        (item) =>
          item.owner.pointer === state().memory[state().destination].selection["config-sources"],
      );
      if (!source) return;
      const observation = await effects.observeConfig(source.id);
      if (observation?.exactRevision) {
        const impact = await effects.previewConfig({ kind: "adopt", id: source.id, observation });
        if (!impact) return;
        setConfigOperation({ kind: "adopt", id: source.id, observation, impact });
        setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
      }
      return;
    }
    if (id === "config-adopt" || id === "config-forget" || id === "config-remove") {
      const config = projection.configs.find((item) => item.level === state().destination);
      const source = config?.direct.configSources.find(
        (item) =>
          item.owner.pointer === state().memory[state().destination].selection["config-sources"],
      );
      if (!source) return;
      if (id === "config-adopt") {
        const observation = await effects.observeConfig(source.id);
        if (!observation?.exactRevision) return;
        const impact = await effects.previewConfig({ kind: "adopt", id: source.id, observation });
        if (!impact) return;
        setConfigOperation({ kind: "adopt", id: source.id, observation, impact });
      } else {
        const kind = id === "config-forget" ? "forget" : "remove";
        const impact = await effects.previewConfig({ kind, id: source.id });
        if (!impact) return;
        setConfigOperation({ kind, id: source.id, impact });
      }
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
      return;
    }
    if (id === "enable-managed-opencode" || id === "disable-managed-opencode") {
      const destination = state().destination;
      if (destination === "workspace") return;
      setConfigOperation({
        kind: "managed",
        level: destination,
        enabled: id === "enable-managed-opencode",
      });
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
      return;
    }
    if (id === "add-membership") {
      const collectionId =
        state().destination === "workspace"
          ? state().memory.workspace.selection.collections
          : state().memory[state().destination].selection.collections;
      const collection =
        projection.effective.status === "complete"
          ? projection.effective.collectionsView.find((item) => item.id === collectionId)
          : undefined;
      const owner =
        state().destination === "workspace"
          ? (collection?.declared.find((item) => !item.contribution && item.level === "project") ??
            collection?.declared.find((item) => !item.contribution))
          : collection?.declared.find(
              (item) => !item.contribution && item.level === state().destination,
            );
      if (!collection || !owner) return;
      setMembershipChooser({ level: owner.level, collection: collection.id });
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "form" }));
      return;
    }
    const selectedCollection = () => {
      if (state().destination === "workspace")
        return projection.effective.status === "complete"
          ? projection.effective.collectionsView
              .find((item) => item.id === state().memory.workspace.selection.collections)
              ?.declared.find((owner) => !owner.contribution)
          : undefined;
      return projection.configs
        .find((item) => item.level === state().destination)
        ?.direct.collections.find(
          (item) => item.id === state().memory[state().destination].selection.collections,
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
      const collection = state().memory[state().destination].selection.collections;
      if (!collection) return;
      if (id === "remove-collection") {
        setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
        const next = await effects.previewCollectionRemoval({
          kind: "collection-removal",
          level: owner.level,
          collection,
        });
        if (next?.kind === "collection-removal" && state().overlay === "confirm")
          setCollectionReview(next);
        return;
      }
      setCollectionDraft(
        id === "import-collection"
          ? { kind: "collection-import", level: owner.level, from: "", into: collection }
          : id === "add-reference"
            ? {
                kind: "reference",
                level: owner.level,
                collection,
                name: "",
                target: "",
                description: "",
              }
            : { kind: "link-change", level: owner.level, collection, target: "", linked: true },
      );
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "form" }));
      return;
    }
    if (id === "set-collection-use") {
      const config = projection.configs.find((item) => item.level === state().destination);
      const destination = state().destination;
      if (!config || destination === "workspace") return;
      setCollectionDraft({
        kind: "collection-use",
        level: destination,
        collections: config.direct.collectionUse.map((item) => item.collection),
      });
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "form" }));
      return;
    }
    if (id === "add-skills" || id === "check-updates") {
      const intent = sourceOperationIntent(id, state(), projection);
      setObservationIntent(intent);
      setState((value) => reduceTui(value, { type: "operation.failure.clear" }));
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "selection" }));
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
      if (next && state().overlay === "selection") {
        setSourceReview(next);
        setSelectedPaths([]);
      }
      return;
    }
    if (id === "view-installed-skills") {
      const source = sourceOperationIntent("add-skills", state(), projection).source;
      const first = state().workspace?.installedSkills.find(
        (skill) => skill.address.source === source,
      );
      setState((value) =>
        reduceTui(
          reduceTui(reduceTui(value, { type: "destination.select", destination: "workspace" }), {
            type: "section.select",
            section: "skills",
          }),
          {
            type: "selection.set",
            key: "skills",
            value: first ? `${first.address.source}/${first.address.path}` : undefined,
          },
        ),
      );
      setState((value) =>
        reduceTui(value, { type: "selection.set", key: "sources", value: source }),
      );
      setState((value) => reduceTui(value, { type: "source.filter.set", source }));
      return;
    }
    if (id === "open-config") {
      const route = sourceRouteIntent(id, state(), projection);
      setState((value) =>
        reduceTui(value, {
          type: "route.source",
          destination: route.owner.level,
          section: "sources",
          selection: route.source,
        }),
      );
      return;
    }
    if (id === "open-config-source") {
      const route = sourceRouteIntent(id, state(), projection);
      setState((value) =>
        reduceTui(value, {
          type: "route.source",
          destination: route.contribution.configSource.level,
          section: "config-sources",
          selection: route.contribution.configSource.pointer,
        }),
      );
      return;
    }
    if (id === "skill-add-to-collection") {
      const skill = installedSkillContext(state(), projection)?.skill;
      const choices =
        projection.effective.status === "complete"
          ? projection.effective.collectionsView.flatMap((item) =>
              item.declared.some((owner) => !owner.contribution)
                ? item.declared
                    .filter((owner) => !owner.contribution)
                    .map((owner) => ({ collection: item.id, level: owner.level }))
                : item.repository.derived
                  ? [{ collection: item.id }]
                  : [],
            )
          : [];
      if (!skill || choices.length === 0) {
        setState((value) =>
          reduceTui(value, {
            type: "operation.failure",
            diagnostic: {
              code: "INVALID_ARGUMENT",
              severity: "warning",
              message: "No direct Collection is available for this Installed Skill",
            },
          }),
        );
        return;
      }
      setCollectionChoices(choices);
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "selection" }));
      return;
    }
    if (id === "skill-for-agents") {
      const skill = installedSkillContext(state(), projection)?.skill;
      if (skill?.selectorViews.status === "complete") {
        setAgentViews(skill.selectorViews);
        setState((value) => reduceTui(value, { type: "overlay.open", overlay: "selection" }));
      }
      return;
    }
    if (id === "skill-uninstall") {
      const skill = installedSkillContext(state(), projection)?.skill;
      if (!skill) return;
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
      void previewInstalled({ kind: "uninstall", address: skill.address });
      return;
    }
    if (id === "skill-rebind") {
      const skill = installedSkillContext(state(), projection)?.skill;
      const sources = projection.effective.sources
        .filter((source) => source.id !== skill?.owner.source)
        .map((source) => source.id);
      if (!skill || sources.length === 0) {
        setState((value) =>
          reduceTui(value, {
            type: "operation.failure",
            diagnostic: {
              code: "SOURCE_NOT_FOUND",
              severity: "warning",
              message: "No alternative Source is available for Rebind",
            },
          }),
        );
        return;
      }
      setRebindSources(sources);
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "selection" }));
      return;
    }
    if (id === "skill-check-updates") {
      const skill = projection.installedSkills.find(
        (item) =>
          `${item.address.source}/${item.address.path}` ===
          state().memory.workspace.selection.skills,
      );
      if (skill) {
        const intent = skillSourceIntent(state(), projection);
        setObservationIntent(intent);
        setState((value) => reduceTui(value, { type: "overlay.open", overlay: "selection" }));
        const next = await effects.checkUpdate({
          kind: intent.kind,
          source: intent.source,
          selectedPath: intent.path,
        });
        if (next && state().overlay === "selection") setSourceReview(next);
      }
      return;
    }
    if (id === "skill-open-source") {
      const skill = installedSkillContext(state(), projection)?.skill;
      if (skill)
        setState((value) =>
          reduceTui(value, {
            type: "route.source",
            destination: "workspace",
            section: "sources",
            selection: skill.owner.source,
          }),
        );
    }
  };
  const previewMembership = async (intent: import("./effects").AddMembershipPreviewRequest) => {
    const next = await effects.previewAddToCollection(intent);
    if (state().overlay !== "confirm" || next?.kind !== "add-to-collection") return;
    if (next.authorized) {
      setCollectionReview(next);
      setMembershipDraft({
        level: next.authorized.level,
        collection: next.authorized.collection,
        address: next.authorized.address,
        initialName: next.authorized.name,
      });
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "form" }));
      return;
    }
    if (next.nextStep) {
      setCollectionReview(undefined);
      effects.discardCollectionReview(next);
      setCollectionCreate({
        allowedLevels: next.nextStep.eligibleLevels,
        afterCreate: { collection: intent.collection, address: intent.address },
      });
      setState((value) => reduceTui(value, { type: "overlay.open", overlay: "form" }));
      return;
    }
    setCollectionReview(next);
  };
  const applyCollectionReview = async () => {
    const current = collectionReview();
    if (!current) return;
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
    if (complete) {
      const collection =
        current.kind === "collection-import"
          ? current.intent.into
          : current.kind === "collection-use"
            ? undefined
            : current.intent.collection;
      setCollectionReview(undefined);
      setMembershipDraft(undefined);
      setCollectionDraft(undefined);
      setState((value) =>
        reduceTui(reduceTui(value, { type: "overlay.close" }), {
          type: "selection.set",
          key: "collections",
          value: collection,
        }),
      );
    }
  };
  const applyMembership = async () => {
    const current = collectionReview();
    if (current?.kind !== "add-to-collection" || !current.authorized) return;
    const complete = await effects.addToCollection(current);
    if (complete) {
      const collection = current.authorized.collection;
      setMembershipDraft(undefined);
      setCollectionReview(undefined);
      setState((value) =>
        reduceTui(reduceTui(value, { type: "overlay.close" }), {
          type: "selection.set",
          key: "collections",
          value: collection,
        }),
      );
    }
  };
  const previewMembershipRemoval = async (
    intent: Extract<import("./effects").CollectionIntent, { readonly kind: "membership-removal" }>,
  ) => {
    setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
    const next = await effects.previewMembershipRemoval(intent);
    if (next?.kind === "membership-removal" && state().overlay === "confirm")
      setCollectionReview(next);
  };
  const confirm = async () => {
    const current = review();
    if (!current) return;
    const complete = await effects.confirm(current);
    if (complete) {
      setReview(undefined);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    }
  };
  const previewRepairInstalled = async (
    request: InstalledSkillPreviewRequest,
    sourceReview: SourceRemovalReview,
  ) => {
    const next = await effects.reviewInstalled(request);
    if (next && review() === sourceReview && repair()) setInstalledReview(next);
  };
  const confirmRepairInstalled = async () => {
    const current = installedReview();
    const sourceReview = review();
    if (!current || !sourceReview || !repair()) return;
    const complete = await effects.confirmInstalled(current);
    if (!complete) return;
    setInstalledReview(undefined);
    setRepair(undefined);
    const next = await effects.review(sourceReview.intent);
    if (next) setReview(next);
  };
  const applySourceSelection = async () => {
    const current = sourceReview();
    if (!current) return;
    const complete =
      current.kind === "discovery"
        ? await effects.install(current, selectedPaths())
        : await effects.update(current, selectedPaths());
    if (complete) {
      setSourceReview(undefined);
      setSelectedPaths([]);
      setState((value) => reduceTui(value, { type: "overlay.close" }));
    }
  };
  let exitRequested = false;
  const interceptModalKey = (event: {
    readonly name: string;
    readonly ctrl: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    const name = event.name.toLowerCase();
    if (
      (state().overlay || state().task) &&
      (name === "escape" || name === "esc" || (event.ctrl && name === "c"))
    ) {
      if (state().overlay === "filter" && filterDimension()) {
        setFilterDimension(undefined);
        setFilterSearch("");
      } else closeOverlay();
      event.preventDefault();
      event.stopPropagation();
    }
  };
  renderer.keyInput.prependListener("keypress", interceptModalKey);
  useKeyboard((event) => {
    const current = state();
    const key = event.name.toLowerCase();
    const focusedId = renderer.currentFocusedRenderable?.id;
    const emptyWorkspace =
      !current.overlay &&
      !current.task &&
      current.destination === "workspace" &&
      current.memory.workspace.section === "skills" &&
      (current.workspace?.installedSkills.length ?? 0) === 0 &&
      !current.sourceFilter;
    if (emptyWorkspace && (key === "enter" || key === "return")) {
      void dispatchAction("add-source");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (emptyWorkspace && key === "tab" && current.focus === "browser") {
      setState((value) => reduceTui(value, { type: "focus.set", focus: "top-nav" }));
      queueMicrotask(() => topNavigation?.focus());
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      !current.overlay &&
      !current.task &&
      ["arrowleft", "left", "arrowright", "right"].includes(key)
    ) {
      const step = key === "arrowleft" || key === "left" ? -1 : 1;
      if (
        current.focus === "top-nav" ||
        focusedId === "top-navigation" ||
        focusedId === "empty-workspace-action"
      ) {
        const index = destinations.indexOf(current.destination);
        selectDestination(
          destinations[(index + step + destinations.length) % destinations.length]!,
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        current.focus === "local-nav" ||
        focusedId === "workspace-section-browser" ||
        focusedId === "config-section-browser"
      ) {
        const sections =
          current.destination === "workspace"
            ? (["skills", "collections", "sources"] as const)
            : (["sources", "config-sources", "collections", "for-agents", "integrations"] as const);
        const sectionDestination =
          current.destination === "workspace" ? "workspace" : current.destination;
        const currentSection = current.memory[sectionDestination].section;
        const index = sections.findIndex((section) => section === currentSection);
        const section = sections[(index + step + sections.length) % sections.length]!;
        setState((value) =>
          reduceTui(value, { type: "section.select", section: section as Section }),
        );
        queueMicrotask(() =>
          renderer.root
            .findDescendantById(
              current.destination === "workspace"
                ? "workspace-section-browser"
                : "config-section-browser",
            )
            ?.focus(),
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (
      !current.overlay &&
      !current.task &&
      key === "tab" &&
      focusedId === "workspace-section-browser"
    ) {
      setState((value) => reduceTui(value, { type: "focus.set", focus: "top-nav" }));
      queueMicrotask(() => topNavigation?.focus());
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      !current.overlay &&
      !current.task &&
      key === "tab" &&
      focusedId === "empty-workspace-action"
    ) {
      setState((value) => reduceTui(value, { type: "focus.set", focus: "top-nav" }));
      queueMicrotask(() => topNavigation?.focus());
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!current.overlay && !current.task && key === "tab" && focusedId === "top-navigation") {
      setState((value) => reduceTui(value, { type: "focus.set", focus: "local-nav" }));
      queueMicrotask(() => {
        const id =
          current.destination === "workspace"
            ? "workspace-section-browser"
            : "config-section-browser";
        renderer.root.findDescendantById(id)?.focus();
      });
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Native Inputs own a literal slash; other modal and escape precedence remains intact.
    if (event.name === "/" && renderer.currentFocusedRenderable instanceof InputRenderable) return;
    if (current.overlay === "filter" && ["enter", "return"].includes(event.name.toLowerCase())) {
      const target = filterDimension() ? "skills-filter-values" : "skills-filter-dimensions";
      if (renderer.currentFocusedRenderable?.id === "skills-filter-search") {
        renderer.root.findDescendantById(target)?.focus();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (current.overlay === "filter" && event.name.toLowerCase() === "tab") {
      const order = [
        "skills-filter-search",
        filterDimension() ? "skills-filter-values" : "skills-filter-dimensions",
        "skills-filter-clear-all",
      ];
      const index = order.indexOf(renderer.currentFocusedRenderable?.id ?? "");
      const next = order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!;
      renderer.root.findDescendantById(next)?.focus();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      (event.name.toLowerCase() === "escape" || event.name.toLowerCase() === "esc") &&
      current.relationshipReturn &&
      !current.overlay &&
      !current.task
    ) {
      setState((value) => reduceTui(value, { type: "route.back" }));
      queueMicrotask(() => {
        const focus = state().focus;
        renderer.root
          .findDescendantById(
            focus === "details-relationships"
              ? "reader-details-relationships"
              : "reader-details-actions",
          )
          ?.focus();
      });
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      current.destination !== "workspace" &&
      current.memory[current.destination].section === "config-sources" &&
      current.focus === "config-source-contributions" &&
      (event.name.toLowerCase() === "escape" || event.name.toLowerCase() === "esc") &&
      !current.overlay
    ) {
      setState((value) => reduceTui(value, { type: "focus.set", focus: "browser" }));
      queueMicrotask(() =>
        renderer.root.findDescendantById("config-config-source-browser")?.focus(),
      );
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      current.destination !== "workspace" &&
      current.memory[current.destination].section === "config-sources" &&
      event.name.toLowerCase() === "tab" &&
      !current.overlay
    ) {
      const hasContributions = !!renderer.root.findDescendantById("config-source-contributions");
      const order: FocusOwner[] = hasContributions
        ? ["browser", "config-source-contributions"]
        : ["browser"];
      const index = order.indexOf(current.focus);
      const next = order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!;
      setState((value) => reduceTui(value, { type: "focus.set", focus: next }));
      queueMicrotask(() =>
        renderer.root
          .findDescendantById(
            next === "config-source-contributions"
              ? "config-source-contributions"
              : "config-config-source-browser",
          )
          ?.focus(),
      );
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const visibleReader = filterSkills(current.workspace?.installedSkills ?? [], {
      query: current.memory.workspace.query.skills,
      filters: current.memory.workspace.filters.skills,
      source: current.sourceFilter,
      agentStatus: current.workspace?.effective.agent.status,
    }).find(
      (skill) =>
        `${skill.address.source}/${skill.address.path}` ===
        current.memory.workspace.selection.skills,
    );
    const readerActive =
      current.destination === "workspace" &&
      current.memory.workspace.section === "skills" &&
      !!visibleReader &&
      !!current.reader.address &&
      `${current.reader.address.source}/${current.reader.address.path}` ===
        `${visibleReader.address.source}/${visibleReader.address.path}`;
    if (
      (event.name.toLowerCase() === "escape" || event.name.toLowerCase() === "esc") &&
      current.focus === "skills-query" &&
      !current.overlay
    ) {
      setState((value) => reduceTui(value, { type: "focus.set", focus: "browser" }));
      queueMicrotask(() => renderer.root.findDescendantById("installed-skill-browser")?.focus());
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      current.destination !== "workspace" &&
      !current.overlay &&
      !current.task &&
      event.name.toLowerCase() === "tab"
    ) {
      const next =
        current.focus === "local-nav"
          ? "browser"
          : event.shift && current.focus === "browser"
            ? "local-nav"
            : undefined;
      if (next) {
        setState((value) => reduceTui(value, { type: "focus.set", focus: next }));
        queueMicrotask(() =>
          renderer.root
            .findDescendantById(next === "local-nav" ? "config-section-browser" : configBrowserId())
            ?.focus(),
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    const collectionsActive =
      current.destination === "workspace" && current.memory.workspace.section === "collections";
    const collectionFilter = current.memory.workspace.collectionFilter;
    if (collectionsActive && collectionFilter?.open) {
      const escape = event.name.toLowerCase() === "escape" || event.name.toLowerCase() === "esc";
      if (escape) {
        const nextFocus: FocusOwner = collectionFilter.dimension
          ? "collections-filter-search"
          : "browser";
        setState((value) =>
          reduceTui(
            reduceTui(
              value,
              collectionFilter.dimension
                ? { type: "collection.filter.dimension" }
                : { type: "collection.filter.close" },
            ),
            { type: "focus.set", focus: nextFocus },
          ),
        );
        queueMicrotask(() =>
          renderer.root
            .findDescendantById(
              collectionFilter.dimension ? "collections-filter-search" : "collection-browser",
            )
            ?.focus(),
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const select = collectionFilter.dimension
        ? "collections-filter-values"
        : "collections-filter-dimensions";
      if (event.name.toLowerCase() === "tab") {
        const order = ["collections-filter-search", select];
        const index = order.indexOf(renderer.currentFocusedRenderable?.id ?? "");
        const next = order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!;
        setState((value) =>
          reduceTui(value, {
            type: "focus.set",
            focus:
              next === "collections-filter-search"
                ? "collections-filter-search"
                : collectionFilter.dimension
                  ? "collections-filter-values"
                  : "collections-filter-dimensions",
          }),
        );
        queueMicrotask(() => renderer.root.findDescendantById(next)?.focus());
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        ["enter", "return"].includes(event.name.toLowerCase()) &&
        renderer.currentFocusedRenderable?.id === "collections-filter-search"
      ) {
        setState((value) =>
          reduceTui(value, {
            type: "focus.set",
            focus: collectionFilter.dimension
              ? "collections-filter-values"
              : "collections-filter-dimensions",
          }),
        );
        queueMicrotask(() => renderer.root.findDescendantById(select)?.focus());
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (
      (event.name.toLowerCase() === "escape" || event.name.toLowerCase() === "esc") &&
      collectionsActive &&
      ["collections-query", "inspector", "collection-relationships"].includes(current.focus) &&
      !current.overlay
    ) {
      setState((value) =>
        reduceTui(
          value.narrow ? reduceTui(value, { type: "narrow.level", level: "list" }) : value,
          { type: "focus.set", focus: "browser" },
        ),
      );
      queueMicrotask(() => renderer.root.findDescendantById("collection-browser")?.focus());
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (collectionsActive && event.name.toLowerCase() === "tab" && !current.overlay) {
      const clearDimensions = Object.keys(current.memory.workspace.filters.collections ?? {});
      const listOrder: FocusOwner[] = [
        "browser",
        "collections-query",
        "collections-filter-open",
        ...(clearDimensions.length ? (["collections-filter-clear"] as const) : []),
        ...(current.memory.workspace.query.collections || clearDimensions.length
          ? (["collections-filter-clear-all"] as const)
          : []),
      ];
      const order: FocusOwner[] = current.narrow
        ? current.narrowLevel === "list"
          ? listOrder
          : ["inspector", "collection-relationships"]
        : [...listOrder, "inspector", "collection-relationships"];
      const index = order.indexOf(current.focus);
      const next = order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!;
      setState((value) => reduceTui(value, { type: "focus.set", focus: next }));
      queueMicrotask(() =>
        renderer.root
          .findDescendantById(
            next === "browser"
              ? "collection-browser"
              : next === "collections-query"
                ? "collections-query"
                : next === "collections-filter-open"
                  ? "collections-filter"
                  : next === "collections-filter-clear"
                    ? `clear-collections-filter-${clearDimensions[0]}`
                    : next === "collections-filter-clear-all"
                      ? "clear-all-collections-filters"
                      : next === "inspector"
                        ? "collection-tabs"
                        : "collection-relationships",
          )
          ?.focus(),
      );
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.name === "/" && collectionsActive && !current.overlay && !current.task) {
      setState((value) => reduceTui(value, { type: "focus.set", focus: "collections-query" }));
      queueMicrotask(() => renderer.root.findDescendantById("collections-query")?.focus());
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.name.toLowerCase() === "/" && readerActive && !current.overlay && !current.task) {
      if (renderer.currentFocusedRenderable?.id === "installed-skill-browser") {
        setState((value) => reduceTui(value, { type: "focus.set", focus: "skills-query" }));
        renderer.root.findDescendantById("skills-query")?.focus();
      } else if (state().overlay === "filter") {
        setState((value) =>
          reduceTui(reduceTui(value, { type: "overlay.close" }), {
            type: "focus.set",
            focus: "browser",
          }),
        );
      } else {
        setState((value) => reduceTui(value, { type: "focus.set", focus: "input" }));
        renderer.root.findDescendantById("reader-find")?.focus();
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      readerActive &&
      event.name.toLowerCase() === "tab" &&
      event.shift &&
      current.focus === "browser" &&
      !current.sourceFilter
    ) {
      setState((value) => reduceTui(value, { type: "focus.set", focus: "local-nav" }));
      renderer.root.findDescendantById("workspace-section-browser")?.focus();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (readerActive && event.name.toLowerCase() === "tab" && !current.overlay && !current.task) {
      const reader = current.reader;
      const source =
        reader.resource?.kind === "text"
          ? reader.resource.text
          : reader.raw
            ? (reader.rawText ?? "")
            : (reader.text ?? "");
      const hasMatch = !!reader.find && findLiteralMatches(source, reader.find).length > 0;
      const order: FocusOwner[] = [];
      if (!current.narrow) order.push("browser");
      if (current.memory.workspace.section === "skills") {
        order.push("skills-query", "skills-filter-open");
        if (Object.keys(current.memory.workspace.filters.skills ?? {}).length > 0)
          order.push("skills-filter-clear");
        if (
          current.memory.workspace.query.skills ||
          Object.keys(current.memory.workspace.filters.skills ?? {}).length > 0
        )
          order.push("skills-filter-clear-all");
      }
      order.push("reader-tabs");
      if (reader.tab === "resources") {
        if (!current.narrow || reader.resourceLevel !== "content")
          order.push("reader-resource-list");
        if (reader.resourceLevel === "content" && reader.resource && !reader.loading)
          order.push("reader-resource-content");
        if (reader.error) order.push("reader-resource-retry");
      } else {
        order.push("reader");
      }
      if (reader.tab === "details") order.push("inspector");
      if (
        reader.tab === "details" &&
        renderer.root.findDescendantById("reader-details-relationships")
      )
        order.push("details-relationships");
      if (reader.tab === "skill") order.push("input", "reader-raw");
      if (reader.tab === "skill" && hasMatch)
        order.push("reader-find-previous", "reader-find-next");
      if (reader.tab === "skill" && !reader.raw && reader.resource?.kind !== "text" && hasMatch)
        order.push("open-match-raw");
      const currentIndex = order.indexOf(current.focus);
      const step = event.shift ? -1 : 1;
      const next = order[(currentIndex + step + order.length) % order.length]!;
      flushReaderFind();
      setState((value) => reduceTui(value, { type: "focus.set", focus: next }));
      renderer.root
        .findDescendantById(
          next === "reader-tabs"
            ? "reader-tabs"
            : next === "reader"
              ? current.reader.tab === "details"
                ? "reader-details"
                : "reader-scrollbox"
              : next === "reader-resource-list"
                ? "resource-browser"
                : next === "reader-resource-content"
                  ? "resource-content"
                  : next === "reader-resource-retry"
                    ? "resource-retry"
                    : next === "input"
                      ? "reader-find"
                      : next === "details-relationships"
                        ? "reader-details-relationships"
                        : next === "browser"
                          ? "installed-skill-browser"
                          : next === "skills-query"
                            ? "skills-query"
                            : next === "skills-filter-open"
                              ? "open-skills-filter"
                              : next === "skills-filter-clear"
                                ? `clear-skills-filter-${Object.keys(current.memory.workspace.filters.skills ?? {})[0]}`
                                : next === "skills-filter-clear-all"
                                  ? "clear-all-skills-filters"
                                  : next,
        )
        ?.focus();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      (event.name.toLowerCase() === "escape" || event.name.toLowerCase() === "esc") &&
      readerActive &&
      [
        "input",
        "reader",
        "reader-tabs",
        "reader-raw",
        "reader-find-previous",
        "reader-find-next",
        "open-match-raw",
        "reader-resource-list",
        "reader-resource-content",
        "reader-resource-retry",
        "inspector",
        "details-relationships",
      ].includes(current.focus)
    ) {
      flushReaderFind();
      if (current.reader.tab === "resources" && current.reader.resourceLevel === "content") {
        setState((value) =>
          reduceTui(
            reduceTui(value, {
              type: "reader.patch",
              value: {
                resourceLevel: "list",
                resource: undefined,
                loading: false,
                error: undefined,
              },
            }),
            { type: "focus.set", focus: "reader-resource-list" },
          ),
        );
        queueMicrotask(() => renderer.root.findDescendantById("resource-browser")?.focus());
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      setState((value) =>
        reduceTui(
          value.narrow ? reduceTui(value, { type: "narrow.level", level: "list" }) : value,
          { type: "focus.set", focus: "browser" },
        ),
      );
      queueMicrotask(() => renderer.root.findDescendantById("installed-skill-browser")?.focus());
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      readerActive &&
      current.focus === "reader" &&
      ["pageup", "pagedown", "home", "end"].includes(event.name.toLowerCase())
    )
      queueMicrotask(() => {
        const scrollbox = renderer.root.findDescendantById(
          current.reader.tab === "details" ? "reader-details" : "reader-scrollbox",
        );
        if (scrollbox && "scrollTop" in scrollbox && Number(scrollbox.scrollTop) > 0)
          setState((value) =>
            reduceTui(value, {
              type: "reader.patch",
              value:
                current.reader.tab === "details"
                  ? { detailsScroll: Number(scrollbox.scrollTop) }
                  : { scroll: Number(scrollbox.scrollTop) },
            }),
          );
      });
    const action = arbitrateKey(event, current);
    if (action === "none") return;
    if (action === "palette") void dispatchAction("open-palette");
    else if (action === "exit" && !exitRequested) {
      exitRequested = true;
      props.exit();
    } else if (action === "close" || action === "cancel") closeOverlay();
    event.preventDefault();
    event.stopPropagation();
  });
  onMount(() => {
    setSize({ width: renderer.width, height: renderer.height });
    setState((current) =>
      reduceTui(current, {
        type: "resize",
        width: renderer.width,
        height: renderer.height,
      }),
    );
    void effects.refresh();
  });
  createEffect(() => {
    const index = destinations.indexOf(state().destination);
    if (topNavigation?.getSelectedIndex() !== index) topNavigation?.setSelectedIndex(index);
  });
  createEffect(() => {
    if (installedReview())
      queueMicrotask(() => renderer.root.findDescendantById("installed-skill-review")?.focus());
    else if (collectionReview())
      queueMicrotask(() => renderer.root.findDescendantById("collection-review-choice")?.focus());
    else if (installedPreviewFailure())
      queueMicrotask(() =>
        renderer.root.findDescendantById("installed-skill-preview-failure")?.focus(),
      );
    else if (installedPreview())
      queueMicrotask(() =>
        renderer.root.findDescendantById("installed-skill-preview-progress")?.focus(),
      );
  });
  createEffect(() => {
    const current = state();
    const selected = current.memory.workspace.selection.skills;
    const skill = filterSkills(current.workspace?.installedSkills ?? [], {
      query: current.memory.workspace.query.skills,
      filters: current.memory.workspace.filters.skills,
      source: current.sourceFilter,
      agentStatus: current.workspace?.effective.agent.status,
    }).find((item) => `${item.address.source}/${item.address.path}` === selected);
    if (
      current.destination === "workspace" &&
      current.memory.workspace.section === "skills" &&
      skill &&
      `${current.reader.address?.source}/${current.reader.address?.path}` !==
        `${skill.address.source}/${skill.address.path}`
    ) {
      const surface =
        current.reader.tab === "details" &&
        (current.focus === "reader" ||
          current.focus === "inspector" ||
          (current.focus === "task" && current.restoreFocus === "inspector"))
          ? "details"
          : undefined;
      setState((value) =>
        reduceTui(value, { type: "reader.activate", address: skill.address, surface }),
      );
      void effects.loadReader(skill.address);
    }
  });
  onResize((width, height) => {
    flushReaderFind();
    setSize({ width, height });
    setState((current) => reduceTui(current, { type: "resize", width, height }));
  });
  onCleanup(() => {
    renderer.keyInput.off("keypress", interceptModalKey);
    effects.teardown();
  });
  const actions = () => reachableActions(state(), state().workspace);
  const selectDestination = (destination: Destination) => {
    if (state().destination === destination) return;
    flushReaderFind();
    setState((current) =>
      reduceTui(reduceTui(current, { type: "destination.select", destination }), {
        type: "focus.set",
        focus: "top-nav",
      }),
    );
  };
  const modal = () => state().overlay;
  const workspaceState = () => ({
    ...state(),
    narrow: size().width < 80,
    tooSmall: size().width < 43 || size().height < 12,
  });
  const configDestination = () => {
    const destination = state().destination;
    return destination === "workspace" ? "global" : destination;
  };
  const configBrowserId = () => {
    const section = state().memory[configDestination()].section;
    return section === "config-sources"
      ? "config-config-source-browser"
      : section === "collections"
        ? "config-collection-browser"
        : section === "for-agents"
          ? "config-agent-use-browser"
          : "config-source-browser";
  };
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="row">
        <text>skill-cli </text>
        <tab_select
          id="top-navigation"
          ref={(value: TabSelectRenderable) => {
            topNavigation = value;
          }}
          width="52%"
          options={topOptions}
          showDescription={false}
          showUnderline={false}
          wrapSelection={false}
          focused={state().focus === "top-nav"}
          onChange={(index) => selectDestination(destinations[index]!)}
        />
        <box flexGrow={1}>
          <text>{state().workspace?.project.root ?? "Loading"}</text>
        </box>
      </box>
      <text>←/→ navigate Tab sections Enter select Ctrl+P actions Esc back</text>
      <Show
        when={
          state().destination !== "workspace" || state().memory.workspace.section !== "collections"
        }
      >
        <text>
          {state().destination === "workspace"
            ? state().memory.workspace.section
            : state().memory[state().destination].section}
        </text>
      </Show>
      <box flexGrow={1}>
        {size().width < 43 || size().height < 12 ? (
          <text>{`Terminal ${size().width}x${size().height} is too small.`}</text>
        ) : (
          <Show
            when={state().destination === "workspace"}
            fallback={
              <ConfigPage
                state={state()}
                destination={configDestination()}
                actions={actions()}
                onSelect={(source) =>
                  setState((value) =>
                    reduceTui(value, {
                      type: "selection.set",
                      key: value.memory[value.destination].section,
                      value: source,
                    }),
                  )
                }
                onActions={() => {
                  if (!modal()) void dispatchAction("open-actions");
                }}
                onSection={(section) => {
                  setState((value) =>
                    reduceTui(reduceTui(value, { type: "section.select", section }), {
                      type: "focus.set",
                      focus: "browser",
                    }),
                  );
                }}
                onContribution={(contribution) => {
                  if (contribution.kind === "source")
                    setState((value) =>
                      reduceTui(
                        reduceTui(value, {
                          type: "handoff.set",
                          handoff: {
                            kind: "source-contribution",
                            source: contribution.source,
                            owner: contribution.owner,
                          },
                        }),
                        {
                          type: "route.relationship",
                          destination: contribution.owner.level,
                          section: "sources",
                          selection: contribution.source.id,
                          returnFocus: "inspector",
                        },
                      ),
                    );
                  else
                    setState((value) =>
                      reduceTui(reduceTui(value, { type: "handoff.set", handoff: undefined }), {
                        type: "route.relationship",
                        destination: contribution.owner.level,
                        section: "collections",
                        selection: contribution.collection,
                        returnFocus: "inspector",
                      }),
                    );
                }}
              />
            }
          >
            <WorkspacePage
              state={workspaceState()}
              actions={actions()}
              onSelectSource={(source) => {
                if (!modal())
                  setState((value) =>
                    reduceTui(value, {
                      type: "selection.set",
                      key: "sources",
                      value: source,
                    }),
                  );
              }}
              onSelectSkill={(skill) => {
                flushReaderFind();
                setState((value) =>
                  reduceTui(value, { type: "selection.set", key: "skills", value: skill }),
                );
                const selected = state().workspace?.installedSkills.find(
                  (item) => `${item.address.source}/${item.address.path}` === skill,
                );
                if (selected) {
                  setState((value) =>
                    reduceTui(value, { type: "reader.activate", address: selected.address }),
                  );
                  void effects.loadReader(selected.address);
                }
              }}
              onActions={() => {
                if (!modal()) void dispatchAction("open-actions");
              }}
              onFirstSkill={() => void dispatchAction("add-source")}
              onDetail={() =>
                setState((value) =>
                  reduceTui(reduceTui(value, { type: "narrow.level", level: "detail" }), {
                    type: "focus.set",
                    focus:
                      value.reader.tab === "resources"
                        ? value.reader.resourceLevel === "content"
                          ? "reader-resource-content"
                          : "reader-resource-list"
                        : value.reader.tab === "details" &&
                            (value.reader.focus === "inspector" ||
                              value.reader.focus === "details-relationships")
                          ? value.reader.focus
                          : "reader",
                  }),
                )
              }
              onClearSourceFilter={() => {
                flushReaderFind();
                setState((value) =>
                  reduceTui(reduceTui(value, { type: "source.filter.set", source: undefined }), {
                    type: "section.select",
                    section: "sources",
                  }),
                );
              }}
              onQuery={(query) => updateSkills({ type: "query.set", key: "skills", value: query })}
              onOpenFilter={() => {
                setFilterDimension(undefined);
                setFilterSearch("");
                setState((value) => reduceTui(value, { type: "overlay.open", overlay: "filter" }));
              }}
              onClearFilter={(dimension) =>
                setState((current) => {
                  const remaining = Object.keys(
                    current.memory.workspace.filters.skills ?? {},
                  ).filter((item) => item !== dimension);
                  const focus: FocusOwner = remaining.length
                    ? "skills-filter-clear"
                    : current.memory.workspace.query.skills
                      ? "skills-filter-clear-all"
                      : "browser";
                  return reduceTui(
                    reconcileSkills(
                      reduceTui(current, { type: "filter.clear", key: "skills", dimension }),
                    ),
                    { type: "focus.set", focus },
                  );
                })
              }
              onClearAllFilters={() =>
                setState((current) =>
                  reduceTui(
                    reconcileSkills(
                      reduceTui(current, { type: "filter.clear-all", key: "skills" }),
                    ),
                    { type: "focus.set", focus: "browser" },
                  ),
                )
              }
              onSelectCollection={(collection) =>
                setState((value) =>
                  reduceTui(value, {
                    type: "selection.set",
                    key: "collections",
                    value: collection,
                  }),
                )
              }
              onCollectionQuery={(query) =>
                updateCollections({ type: "query.set", key: "collections", value: query })
              }
              onCollectionFilter={(dimension, value) =>
                updateCollections({ type: "filter.set", key: "collections", dimension, value })
              }
              onClearCollectionFilter={(dimension) => {
                let focus: FocusOwner = "browser";
                setState((current) => {
                  const remaining = Object.keys(
                    current.memory.workspace.filters.collections ?? {},
                  ).filter((item) => item !== dimension);
                  focus = remaining.length
                    ? "collections-filter-clear"
                    : current.memory.workspace.query.collections
                      ? "collections-filter-clear-all"
                      : "browser";
                  return reduceTui(
                    reconcileCollections(
                      reduceTui(current, { type: "filter.clear", key: "collections", dimension }),
                    ),
                    {
                      type: "focus.set",
                      focus,
                    },
                  );
                });
                queueMicrotask(() =>
                  renderer.root
                    .findDescendantById(
                      focus === "collections-filter-clear"
                        ? `clear-collections-filter-${Object.keys(state().memory.workspace.filters.collections ?? {})[0]}`
                        : focus === "collections-filter-clear-all"
                          ? "clear-all-collections-filters"
                          : "collection-browser",
                    )
                    ?.focus(),
                );
              }}
              onClearAllCollectionFilters={() => {
                setState((current) =>
                  reduceTui(
                    reconcileCollections(
                      reduceTui(current, { type: "filter.clear-all", key: "collections" }),
                    ),
                    { type: "focus.set", focus: "browser" },
                  ),
                );
                queueMicrotask(() =>
                  renderer.root.findDescendantById("collection-browser")?.focus(),
                );
              }}
              onCollectionFilterOpen={() =>
                setState((value) =>
                  reduceTui(reduceTui(value, { type: "collection.filter.open" }), {
                    type: "focus.set",
                    focus: "collections-filter-search",
                  }),
                )
              }
              onCollectionFilterDimension={(dimension) =>
                setState((value) =>
                  reduceTui(reduceTui(value, { type: "collection.filter.dimension", dimension }), {
                    type: "focus.set",
                    focus: "collections-filter-search",
                  }),
                )
              }
              onCollectionFilterSearch={(value) =>
                setState((state) => reduceTui(state, { type: "collection.filter.search", value }))
              }
              onCollectionFilterClose={() =>
                setState((value) =>
                  reduceTui(reduceTui(value, { type: "collection.filter.close" }), {
                    type: "focus.set",
                    focus: "browser",
                  }),
                )
              }
              onCollectionTab={(collection, tab) =>
                setState((value) =>
                  reduceTui(value, { type: "collection.tab.set", collection, tab }),
                )
              }
              onCollectionDetail={() =>
                setState((value) =>
                  reduceTui(reduceTui(value, { type: "narrow.level", level: "detail" }), {
                    type: "focus.set",
                    focus: "inspector",
                  }),
                )
              }
              onCollectionRelationship={(intent: CollectionRelationshipIntent) => {
                if (intent.kind === "collection-producer") {
                  setState((value) =>
                    reduceTui(
                      reduceTui(value, {
                        type: "handoff.set",
                        handoff: { kind: "agent-producer", address: intent.address },
                      }),
                      {
                        type: "route.source",
                        destination: "workspace",
                        section: "skills",
                        selection: `${intent.address.source}/${intent.address.path}`,
                      },
                    ),
                  );
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
                  setCollectionDraft({
                    kind: "reference",
                    level: intent.owner.level,
                    collection: intent.collection,
                    name: intent.name,
                    target: intent.target,
                    description: intent.description,
                    remove: true,
                  });
                  setState((value) => reduceTui(value, { type: "overlay.open", overlay: "form" }));
                  return;
                }
                if (intent.kind === "collection-link" && !intent.owner.contribution) {
                  setCollectionDraft({
                    kind: "link-change",
                    level: intent.owner.level,
                    collection: intent.collection,
                    target: intent.target,
                    linked: false,
                  });
                  setState((value) => reduceTui(value, { type: "overlay.open", overlay: "form" }));
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
                setState((value) =>
                  reduceTui(reduceTui(value, { type: "handoff.set", handoff }), {
                    type: "route.source",
                    destination: intent.owner.level,
                    section: intent.owner.contribution ? "config-sources" : "collections",
                    selection: intent.owner.contribution
                      ? intent.owner.contribution.configSource.pointer
                      : intent.collection,
                  }),
                );
              }}
              onSection={(section) => {
                flushReaderFind();
                setState((value) =>
                  reduceTui(reduceTui(value, { type: "section.select", section }), {
                    type: "focus.set",
                    focus: "browser",
                  }),
                );
              }}
              onReaderPatch={(reader) =>
                setState((value) => {
                  const patched = reduceTui(value, { type: "reader.patch", value: reader });
                  if (reader.tab === "resources")
                    return reduceTui(patched, {
                      type: "focus.set",
                      focus: "reader-resource-list",
                    });
                  if (reader.tab === "details")
                    return reduceTui(patched, { type: "focus.set", focus: "reader" });
                  return reader.raw && reader.scroll !== undefined
                    ? reduceTui(patched, { type: "focus.set", focus: "reader" })
                    : patched;
                })
              }
              onReaderFindCommit={(value) => {
                setState((current) =>
                  reduceTui(current, {
                    type: "reader.patch",
                    value: {
                      find: value,
                      match: current.reader.find === value ? current.reader.match : 0,
                    },
                  }),
                );
              }}
              onRegisterReaderFindCommit={(commit) => {
                commitReaderFind = commit;
              }}
              onResources={(address) => void effects.listResources(address)}
              onReadResource={(address, path) => {
                setState((value) =>
                  reduceTui(value, { type: "focus.set", focus: "reader-resource-content" }),
                );
                void effects.readResource(address, path);
              }}
              onRetryResource={(address) => {
                const reader = state().reader;
                if (reader.resourceLevel === "content" && reader.selectedResource)
                  void effects.readResource(address, reader.selectedResource);
                else void effects.listResources(address);
              }}
              onResourceBack={() =>
                setState((value) =>
                  reduceTui(
                    reduceTui(value, {
                      type: "reader.patch",
                      value: {
                        resourceLevel: "list",
                        resource: undefined,
                        loading: false,
                        error: undefined,
                      },
                    }),
                    { type: "focus.set", focus: "reader-resource-list" },
                  ),
                )
              }
              onDetailsActions={() => {
                if (!modal()) void dispatchAction("open-actions");
              }}
              onDetailsRelationship={(relationship) => {
                const skill = installedSkillContext(state(), state().workspace)?.skill;
                if (!skill?.source) return;
                if (relationship === "source") {
                  const owner = state()
                    .workspace?.configs.flatMap((config) => config.direct.sources)
                    .find((source) => source.id === skill.source!.id)?.ref.owner;
                  const handoff = skill.source.contribution
                    ? {
                        kind: "source-contribution" as const,
                        source: skill.source,
                        owner: skill.source.contribution.configSource,
                      }
                    : owner
                      ? { kind: "source-declaration" as const, source: skill.source, owner }
                      : undefined;
                  if (handoff)
                    setState((value) =>
                      reduceTui(reduceTui(value, { type: "handoff.set", handoff }), {
                        type: "route.relationship",
                        destination: "workspace",
                        section: "sources",
                        selection: skill.owner.source,
                        returnFocus: "details-relationships",
                      }),
                    );
                } else if (relationship === "config") {
                  const owner = state()
                    .workspace?.configs.flatMap((config) => config.direct.sources)
                    .find((source) => source.id === skill.owner.source)?.ref.owner;
                  if (owner)
                    setState((value) =>
                      reduceTui(
                        reduceTui(value, {
                          type: "handoff.set",
                          handoff: { kind: "source-declaration", source: skill.source!, owner },
                        }),
                        {
                          type: "route.relationship",
                          destination: owner.level,
                          section: "sources",
                          selection: skill.owner.source,
                          returnFocus: "details-relationships",
                        },
                      ),
                    );
                } else if (relationship === "config-source" && skill.source.contribution)
                  setState((value) =>
                    reduceTui(
                      reduceTui(value, {
                        type: "handoff.set",
                        handoff: {
                          kind: "source-contribution",
                          source: skill.source!,
                          owner: skill.source!.contribution!.configSource,
                        },
                      }),
                      {
                        type: "route.relationship",
                        destination: skill.source!.contribution!.configSource.level,
                        section: "config-sources",
                        selection: skill.source!.contribution!.configSource.pointer,
                        returnFocus: "details-relationships",
                      },
                    ),
                  );
                else if (relationship.startsWith("collection:")) {
                  const collection = relationship.slice("collection:".length);
                  const direct = skill.collections
                    .find((item) => item.id === collection)
                    ?.paths.find((path) => path.kind === "direct");
                  const owner = direct?.kind === "direct" ? direct.owner : undefined;
                  if (owner)
                    setState((value) =>
                      reduceTui(value, {
                        type: "route.relationship",
                        destination: owner.contribution
                          ? owner.contribution.configSource.level
                          : owner.level,
                        section: owner.contribution ? "config-sources" : "collections",
                        selection: owner.contribution
                          ? owner.contribution.configSource.pointer
                          : collection,
                        returnFocus: "details-relationships",
                      }),
                    );
                } else if (relationship === "selectors") void dispatchAction("skill-for-agents");
              }}
              onDetailsScroll={(scroll) =>
                setState((value) =>
                  reduceTui(value, { type: "reader.patch", value: { detailsScroll: scroll } }),
                )
              }
            />
          </Show>
        )}
      </box>
      <text>{state().task?.cancellationRequested ? "Cancelling operation" : state().status}</text>
      {(modal() === "actions" || modal() === "palette") && (
        <ActionOverlay
          title={modal() === "actions" ? "Actions" : "Palette"}
          actions={actions()}
          onSelect={(id) => {
            if (isDestination(id)) {
              selectDestination(id);
              setState((value) => reduceTui(value, { type: "overlay.close" }));
              return;
            }
            if (id === "open-actions" || id === "open-palette") return;
            void dispatchAction(id);
          }}
          onClose={closeOverlay}
        />
      )}
      {modal() === "filter" && (
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
                        name: `${dimension}  ${state().memory.workspace.filters.skills?.[dimension] ?? "Any"}`,
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
                      { name: "Any", description: "Clear this filter", value: "" },
                      ...filterValues(
                        state().workspace?.installedSkills ?? [],
                        filterDimension()!,
                        state().workspace?.effective.agent.status,
                      )
                        .filter((value) =>
                          value.toLocaleLowerCase().includes(filterSearch().toLocaleLowerCase()),
                        )
                        .map((value) => ({ name: value, description: "Filter value", value })),
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
                      state().workspace?.installedSkills ?? [],
                      filterDimension()!,
                      state().workspace?.effective.agent.status,
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
                { name: "Clear all", description: "Clear query and local filters", value: "clear" },
              ]}
              showDescription={false}
              onSelect={() => {
                setFilterDimension(undefined);
                updateSkills({ type: "filter.clear-all", key: "skills" });
              }}
            />
          </box>
        </>
      )}
      {agentViews() && (
        <AgentPathsOverlay
          views={agentViews()!}
          onClose={closeOverlay}
          onSelect={(value) => {
            const [kind, selectorIndex, pathIndex, linkIndex] = value.split(":");
            const views = agentViews();
            const view =
              views?.status === "complete" ? views.values[Number(selectorIndex)] : undefined;
            if (!view) return;
            if (kind === "path") {
              const path = view.paths[Number(pathIndex)];
              if (path?.kind === "direct") {
                const owner = path.owner;
                if (owner)
                  setState((current) =>
                    reduceTui(
                      reduceTui(current, {
                        type: "handoff.set",
                        handoff: {
                          kind: "agent-membership",
                          collection: path.collection,
                          entry: path.entryName,
                          owner,
                        },
                      }),
                      owner.contribution
                        ? {
                            type: "route.relationship",
                            destination: owner.contribution.configSource.level,
                            section: "config-sources",
                            selection: owner.contribution.configSource.pointer,
                            returnFocus: "inspector",
                          }
                        : {
                            type: "route.relationship",
                            destination: owner.level,
                            section: "collections",
                            selection: path.collection,
                            returnFocus: "inspector",
                          },
                    ),
                  );
              } else if (path?.kind === "repository-derived") {
                setState((current) =>
                  reduceTui(
                    reduceTui(current, {
                      type: "handoff.set",
                      handoff: {
                        kind: "agent-producer",
                        address: { source: path.source, path: path.path },
                      },
                    }),
                    {
                      type: "route.source",
                      destination: "workspace",
                      section: "skills",
                      selection: `${path.source}/${path.path}`,
                    },
                  ),
                );
              }
            } else if (kind === "link") {
              const path = view.paths[Number(pathIndex)];
              if (path?.kind === "via-link") {
                const link = path.links[Number(linkIndex)];
                const owner = link?.owner;
                if (owner)
                  setState((current) =>
                    reduceTui(
                      reduceTui(current, {
                        type: "handoff.set",
                        handoff: {
                          kind: "agent-link",
                          collection: link.collection,
                          linkedCollection: link.linkedCollection,
                          owner,
                        },
                      }),
                      owner.contribution
                        ? {
                            type: "route.relationship",
                            destination: owner.contribution.configSource.level,
                            section: "config-sources",
                            selection: owner.contribution.configSource.pointer,
                            returnFocus: "inspector",
                          }
                        : {
                            type: "route.relationship",
                            destination: owner.level,
                            section: "collections",
                            selection: link.collection,
                            returnFocus: "inspector",
                          },
                    ),
                  );
              }
            } else if (kind === "use") {
              const owner = view.useOwners[Number(pathIndex)];
              if (owner)
                setState((current) =>
                  reduceTui(
                    reduceTui(current, {
                      type: "handoff.set",
                      handoff: {
                        kind: "agent-use",
                        collection: view.collection,
                        owner,
                      },
                    }),
                    {
                      type: "route.source",
                      destination: owner.level,
                      section: "for-agents",
                      selection: view.collection,
                    },
                  ),
                );
            }
            setAgentViews(undefined);
            setState((current) =>
              reduceTui(reduceTui(current, { type: "overlay.close" }), {
                type: "focus.set",
                focus: "browser",
              }),
            );
          }}
        />
      )}
      {rebindSources() && (
        <RebindSourceOverlay
          sources={rebindSources()!}
          onClose={closeOverlay}
          onSelect={(owner, ownerPath) => {
            const repairing = repair();
            const skill = installedSkillContext(state(), state().workspace)?.skill;
            const address = repairing
              ? { source: repairing.source, path: repairing.path }
              : skill?.address;
            if (!address) return;
            setRebindSources(undefined);
            setState((current) => reduceTui(current, { type: "overlay.open", overlay: "confirm" }));
            if (repair() && review())
              void previewRepairInstalled({ kind: "rebind", address, owner, ownerPath }, review()!);
            else void previewInstalled({ kind: "rebind", address, owner, ownerPath });
          }}
        />
      )}
      {installedPreviewFailure() && (
        <InstalledSkillPreviewFailureOverlay
          request={installedPreviewFailure()!}
          error={state().operationProblem}
          pending={installedPreviewRetrying()}
          cancelling={installedPreviewCancelling()}
          onRetry={() => void previewInstalled(installedPreviewFailure()!)}
          onCancel={closeOverlay}
        />
      )}
      {installedPreview() && !installedPreviewFailure() && (
        <InstalledSkillPreviewOverlay
          request={installedPreview()!}
          cancelling={installedPreviewCancelling()}
          onCancel={closeOverlay}
        />
      )}
      {collectionChoices() && (
        <CollectionHandoffOverlay
          choices={collectionChoices()!}
          onClose={closeOverlay}
          onSelect={(choice) => {
            const skill = installedSkillContext(state(), state().workspace)?.skill;
            if (!skill) return;
            setCollectionChoices(undefined);
            setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
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
      {collectionCreate() && (
        <CollectionCreateOverlay
          {...(collectionCreate()!.allowedLevels
            ? { allowedLevels: collectionCreate()!.allowedLevels! }
            : { level: collectionCreate()!.level! })}
          collection=""
          pending={effects.pendingKind() === "execute"}
          error={state().operationProblem}
          onCancel={closeOverlay}
          onSubmit={(intent) => {
            void effects
              .createCollection({ kind: "collection-create", ...intent })
              .then((complete) => {
                if (complete) {
                  const afterCreate = collectionCreate()?.afterCreate;
                  setCollectionCreate(undefined);
                  setState((value) =>
                    reduceTui(reduceTui(value, { type: "overlay.close" }), {
                      type: "selection.set",
                      key: "collections",
                      value: intent.collection,
                    }),
                  );
                  if (afterCreate) {
                    setState((value) =>
                      reduceTui(value, { type: "overlay.open", overlay: "confirm" }),
                    );
                    void previewMembership({
                      kind: "add-to-collection",
                      level: intent.level,
                      collection: afterCreate.collection,
                      address: afterCreate.address,
                      name: afterCreate.address.path.split("/").at(-1) ?? "skill",
                    });
                  }
                }
              });
          }}
        />
      )}
      {modal() === "form" && membershipChooser() && (
        <InstalledSkillChooserOverlay
          skills={(state().workspace?.installedSkills ?? []).map((skill) => ({
            address: skill.address,
            name: skill.name,
            description: skill.description,
          }))}
          onClose={() => {
            setMembershipChooser(undefined);
            closeOverlay();
          }}
          onSelect={(address, name) => {
            const target = membershipChooser();
            if (!target) return;
            setMembershipChooser(undefined);
            setMembershipDraft({ ...target, address, initialName: name });
          }}
        />
      )}
      {modal() === "form" &&
        membershipDraft() &&
        collectionReview()?.kind === "add-to-collection" && (
          <MembershipAddOverlay
            level={membershipDraft()!.level}
            collection={membershipDraft()!.collection}
            address={membershipDraft()!.address}
            initialName={membershipDraft()!.initialName}
            pending={effects.pendingKind() === "preview"}
            error={state().operationProblem}
            onCancel={closeOverlay}
            onPreview={(intent) => {
              setState((value) => reduceTui(value, { type: "overlay.open", overlay: "confirm" }));
              void effects.previewAddToCollection(intent).then((next) => {
                if (next?.kind === "add-to-collection" && state().overlay === "confirm") {
                  setCollectionReview(next);
                  setMembershipDraft(undefined);
                }
              });
            }}
          />
        )}
      {sourceRegistration() && (
        <SourceRegistrationOverlay
          kind={sourceRegistration()!.kind}
          level={sourceRegistration()!.level}
          pending={effects.pendingKind() === "execute"}
          error={state().operationProblem}
          onCancel={closeOverlay}
          onSubmit={(value) => {
            const registration = sourceRegistration()!;
            void effects
              .registerSource({
                type: registration.kind === "source" ? "source.register" : "config-source.register",
                level: value.level,
                id: value.id,
                binding: value.binding,
              })
              .then((complete) => {
                if (complete) {
                  const section = registration.kind === "source" ? "sources" : "config-sources";
                  setSourceRegistration(undefined);
                  setState((current) =>
                    reduceTui(reduceTui(current, { type: "overlay.close" }), {
                      type: "route.source",
                      destination: value.level,
                      section,
                      selection:
                        registration.kind === "source" ? value.id : `/configSources/${value.id}`,
                    }),
                  );
                }
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
              pending={effects.pendingKind() === "preview"}
              error={state().operationProblem}
              onCancel={closeOverlay}
              onPreview={(intent) =>
                void effects.previewImport(intent).then((review) => {
                  if (review?.kind === "collection-import" && state().overlay === "form") {
                    setCollectionReview(review);
                    setCollectionDraft(undefined);
                    setState((value) =>
                      reduceTui(value, { type: "overlay.open", overlay: "confirm" }),
                    );
                  }
                })
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
              pending={effects.pendingKind() === "preview"}
              error={state().operationProblem}
              onCancel={closeOverlay}
              onPreview={(intent) =>
                void effects.previewReference(intent).then((review) => {
                  if (review?.kind === "reference" && state().overlay === "form") {
                    setCollectionReview(review);
                    setCollectionDraft(undefined);
                    setState((value) =>
                      reduceTui(value, { type: "overlay.open", overlay: "confirm" }),
                    );
                  }
                })
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
              pending={effects.pendingKind() === "preview"}
              error={state().operationProblem}
              onCancel={closeOverlay}
              onPreview={(intent) =>
                void effects.previewLinkChange(intent).then((review) => {
                  if (review?.kind === "link-change" && state().overlay === "form") {
                    setCollectionReview(review);
                    setCollectionDraft(undefined);
                    setState((value) =>
                      reduceTui(value, { type: "overlay.open", overlay: "confirm" }),
                    );
                  }
                })
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
              pending={effects.pendingKind() === "preview"}
              error={state().operationProblem}
              onCancel={closeOverlay}
              onPreview={(intent) =>
                void effects.previewCollectionUse(intent).then((review) => {
                  if (review?.kind === "collection-use" && state().overlay === "form") {
                    setCollectionReview(review);
                    setCollectionDraft(undefined);
                    setState((value) =>
                      reduceTui(value, { type: "overlay.open", overlay: "confirm" }),
                    );
                  }
                })
              }
            />
          );
        })()}
      {modal() === "confirm" && collectionReview() && (
        <CollectionReviewOverlay
          review={collectionReview()!}
          pending={effects.pendingKind() === "execute"}
          error={state().operationProblem}
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
                  ? [{ name: "Cancel", description: "Return without mutation", value: "cancel" }]
                  : [
                      {
                        name: "Cancel",
                        description: "Keep current configuration",
                        value: "cancel",
                      },
                      {
                        name: effects.pendingKind() === "execute" ? "Applying" : "Confirm",
                        description: "Apply reviewed operation",
                        value: "confirm",
                      },
                    ]
              }
              onSelect={(_index, option) => {
                if (option?.value === "cancel") closeOverlay();
                else if (option?.value === "confirm" && effects.pendingKind() !== "execute") {
                  const operation = configOperation()!;
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
                    if (complete) {
                      setConfigOperation(undefined);
                      setState((value) => reduceTui(value, { type: "overlay.close" }));
                    }
                  });
                }
              }}
            />
            <text>Cancel is selected by default</text>
          </box>
        </box>
      )}
      {installedReview() && (
        <InstalledSkillReviewOverlay
          review={installedReview()!}
          pending={effects.pendingKind() === "execute"}
          error={state().operationProblem}
          onResolveMembership={(owner) => {
            const current = installedReview()!;
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
              setState((value) =>
                reduceTui(value, {
                  type: "operation.failure",
                  diagnostic: {
                    code: "INVALID_ARGUMENT",
                    severity: "warning",
                    message: `No disappearing selector directly matches ${owner.file} ${owner.pointer}`,
                  },
                }),
              );
              return;
            }
            const [collection, entry] = selector.selector.split(":", 2);
            setInstalledReview(undefined);
            setState((value) =>
              reduceTui(
                reduceTui(value, {
                  type: "handoff.set",
                  handoff: {
                    kind: "uninstall-membership",
                    address: current.address,
                    owner,
                    collection,
                    entry,
                  },
                }),
                {
                  type: "route.source",
                  destination: owner.level,
                  section: "collections",
                  selection: collection,
                },
              ),
            );
          }}
          onCancel={closeOverlay}
          onConfirm={() => {
            const current = installedReview()!;
            if (repair()) {
              void confirmRepairInstalled();
              return;
            }
            void effects.confirmInstalled(current).then((complete) => {
              if (complete) {
                setInstalledReview(undefined);
                setState((value) => reduceTui(value, { type: "overlay.close" }));
              }
            });
          }}
        />
      )}
      {review() && !installedReview() && !rebindSources() && (
        <SourceRemovalOverlay
          review={review()!}
          pending={!!state().task}
          error={state().operationProblem}
          onConfirm={() => {
            void confirm();
          }}
          onCancel={closeOverlay}
          onRepair={(action, address) => {
            const current = review();
            if (!current) return;
            setRepair({ action, ...address });
            if (action === "uninstall")
              void previewRepairInstalled({ kind: "uninstall", address }, current);
            else {
              const sources = state()
                .workspace?.effective.sources.filter((source) => source.id !== address.source)
                .map((source) => source.id);
              if (sources?.length) setRebindSources(sources);
              else
                setState((value) =>
                  reduceTui(value, {
                    type: "operation.failure",
                    diagnostic: {
                      code: "SOURCE_NOT_FOUND",
                      severity: "warning",
                      message: "No alternative Source is available for Rebind",
                    },
                  }),
                );
            }
          }}
        />
      )}
      {sourceReview() && (
        <SourceSelectionOverlay
          review={sourceReview()!}
          installed={
            new Set(
              (state().workspace?.installedSkills ?? [])
                .filter((skill) => skill.address.source === sourceReview()!.observation.source)
                .map((skill) => skill.address.path),
            )
          }
          selected={selectedPaths()}
          pending={effects.pendingKind() === "execute"}
          error={state().operationProblem}
          onToggle={(path) =>
            setSelectedPaths((paths) =>
              paths.includes(path) ? paths.filter((value) => value !== path) : [...paths, path],
            )
          }
          onSubmit={() => {
            void applySourceSelection();
          }}
          onCancel={closeOverlay}
        />
      )}
      {modal() === "selection" && !sourceReview() && observationIntent() && (
        <SourceObservationOverlay
          title={
            observationIntent()!.kind === "source-discovery"
              ? "Discovering Skills"
              : "Checking Updates"
          }
          source={observationIntent()!.source}
          cancelling={state().task?.cancellationRequested ?? false}
          error={state().operationProblem}
          onRetry={() => {
            const intent = observationIntent()!;
            setState((value) => reduceTui(value, { type: "operation.failure.clear" }));
            void (
              intent.kind === "source-discovery"
                ? effects.discover(intent)
                : effects.checkUpdate(intent)
            ).then((next) => {
              if (next && state().overlay === "selection") {
                setSourceReview(next);
                setSelectedPaths([]);
              }
            });
          }}
          onClose={() => {
            if (effects.pendingKind() === "observe") effects.cancel();
            else {
              setObservationIntent(undefined);
              setState((value) => reduceTui(value, { type: "overlay.close" }));
            }
          }}
        />
      )}
      {modal() === "confirm" &&
        !review() &&
        !installedPreview() &&
        !installedPreviewFailure() &&
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

export const createTuiController = (core: TuiCore) => createTuiEffects(core);
