import type { Diagnostic } from "@skill-cli/core";
import type { LoadedInstalledSkill, ReadInstalledResource, ReaderState } from "../types";
import { skillAddressKey } from "../types";

export type ReaderAddress = { readonly source: string; readonly path: string };
export type ReaderRequest = "content" | "resources" | "resource";

export interface ReaderOwnerState {
  readonly activeKey?: string;
  readonly cache: Readonly<Record<string, ReaderState | undefined>>;
  readonly epochs: Readonly<Record<string, number | undefined>>;
}

// A resource list and a resource body share one visible lane; content is independent.
const epochKey = (address: ReaderAddress, request: ReaderRequest) =>
  `${skillAddressKey(address)}:${request === "content" ? request : "resource"}`;

export type ReaderEvent =
  | { readonly type: "select"; readonly address: ReaderAddress; readonly surface?: "details" }
  | { readonly type: "restore"; readonly value: ReaderState }
  | { readonly type: "patch"; readonly value: Partial<ReaderState> }
  | { readonly type: "resource-abandon" }
  | { readonly type: "content.cancel"; readonly address: ReaderAddress; readonly epoch: number }
  // No address means an explicit refresh of all installed payloads, including Local files.
  | { readonly type: "content.invalidate"; readonly address?: ReaderAddress }
  | { readonly type: "content.start"; readonly address: ReaderAddress; readonly epoch: number }
  | { readonly type: "resources.start"; readonly address: ReaderAddress; readonly epoch: number }
  | {
      readonly type: "resource.start";
      readonly address: ReaderAddress;
      readonly epoch: number;
      readonly path: string;
    }
  | {
      readonly type: "content.settle";
      readonly address: ReaderAddress;
      readonly epoch: number;
      readonly value: Pick<LoadedInstalledSkill, "markdownText" | "rawText">;
    }
  | {
      readonly type: "resources.settle";
      readonly address: ReaderAddress;
      readonly epoch: number;
      readonly resources: ReaderState["resources"];
    }
  | {
      readonly type: "resource.settle";
      readonly address: ReaderAddress;
      readonly epoch: number;
      readonly value: ReadInstalledResource;
    }
  | {
      readonly type: "failure";
      readonly address: ReaderAddress;
      readonly epoch: number;
      readonly request: ReaderRequest;
      readonly diagnostic: Diagnostic;
    };

export function beginReaderRequest(
  state: ReaderOwnerState,
  address: ReaderAddress,
  request: ReaderRequest,
  path?: string,
): {
  readonly state: ReaderOwnerState;
  readonly event: Extract<ReaderEvent, { readonly type: `${string}.start` }>;
} {
  const epoch = (state.epochs[epochKey(address, request)] ?? 0) + 1;
  const event =
    request === "content"
      ? ({ type: "content.start", address, epoch } as const)
      : request === "resources"
        ? ({ type: "resources.start", address, epoch } as const)
        : ({ type: "resource.start", address, epoch, path: path! } as const);
  const allocated = { ...state, epochs: { ...state.epochs, [epochKey(address, request)]: epoch } };
  return {
    state: reduceReaderState(allocated, event),
    event,
  };
}

const initialReader = (address: ReaderAddress): ReaderState => ({
  address,
  tab: "skill",
  raw: false,
  find: "",
  match: 0,
  scroll: 0,
  detailsScroll: 0,
  resources: [],
});

export const createReaderState = (): ReaderOwnerState => ({ cache: {}, epochs: {} });

const replace = (state: ReaderOwnerState, key: string, reader: ReaderState): ReaderOwnerState => ({
  ...state,
  cache: { ...state.cache, [key]: reader },
});

export const activeReader = (state: ReaderOwnerState): ReaderState | undefined =>
  state.activeKey ? state.cache[state.activeKey] : undefined;

export function reduceReaderEvent(
  state: ReaderOwnerState,
  event: ReaderEvent,
): { readonly state: ReaderOwnerState; readonly accepted: boolean } {
  if (event.type === "select") {
    const key = skillAddressKey(event.address);
    const reader = state.cache[key] ?? initialReader(event.address);
    const active =
      event.surface === "details"
        ? { ...reader, tab: "details" as const, focus: "reader" as const }
        : reader;
    return { state: { ...replace(state, key, active), activeKey: key }, accepted: true };
  }
  if (event.type === "restore") {
    const saved = event.value;
    if (!saved.address) return { state, accepted: false };
    const key = skillAddressKey(saved.address);
    const reader = state.cache[key] ?? initialReader(saved.address);
    // Route frames own interaction history, not installed bytes or request lifetime.
    const restored: ReaderState = {
      ...reader,
      tab: saved.tab,
      raw: saved.raw,
      find: saved.find,
      match: saved.match,
      scroll: saved.scroll,
      detailsScroll: saved.detailsScroll,
      detailsManagementOpen: saved.detailsManagementOpen,
      detailsDescriptionOpen: saved.detailsDescriptionOpen,
      detailsMetadataOpen: saved.detailsMetadataOpen,
      focus: saved.focus,
      selectedResource: saved.selectedResource,
      resourceLevel:
        saved.resourceLevel === "content" &&
        reader.resource !== undefined &&
        reader.resource.path === saved.selectedResource
          ? "content"
          : "list",
    };
    return { state: { ...replace(state, key, restored), activeKey: key }, accepted: true };
  }
  if (event.type === "content.invalidate") {
    const keys = event.address ? [skillAddressKey(event.address)] : Object.keys(state.cache);
    const cache = { ...state.cache };
    const epochs = { ...state.epochs };
    let accepted = false;
    for (const key of keys) {
      const reader = cache[key];
      if (!reader?.address) continue;
      accepted = true;
      // Keep reading preferences/positions, but never treat an old installed payload as fresh.
      cache[key] = {
        ...reader,
        text: undefined,
        rawText: undefined,
        loading: false,
        error: undefined,
        resources: [],
        resourcesLoaded: false,
        resourceLoading: false,
        resource: undefined,
        resourceLevel: "list",
      };
      for (const request of ["content", "resource"] as const) {
        const lane = epochKey(reader.address, request);
        epochs[lane] = (epochs[lane] ?? 0) + 1;
      }
    }
    return { state: accepted ? { ...state, cache, epochs } : state, accepted };
  }
  const active = activeReader(state);
  if (event.type === "patch") {
    if (!active || !state.activeKey) return { state, accepted: false };
    return {
      state: replace(state, state.activeKey, { ...active, ...event.value }),
      accepted: true,
    };
  }
  if (event.type === "resource-abandon") {
    if (!active?.address || !state.activeKey) return { state, accepted: false };
    const lane = epochKey(active.address, "resource");
    return {
      state: {
        ...replace(state, state.activeKey, {
          ...active,
          resourceLevel: "list",
          resourceLoading: false,
          error: active.resourceLoading || active.tab === "resources" ? undefined : active.error,
        }),
        epochs: { ...state.epochs, [lane]: (state.epochs[lane] ?? 0) + 1 },
      },
      accepted: true,
    };
  }
  const key = skillAddressKey(event.address);
  const reader = state.cache[key];
  if (!reader) return { state, accepted: false };
  if (event.type === "content.cancel") {
    const lane = epochKey(event.address, "content");
    if (state.epochs[lane] !== event.epoch) return { state, accepted: false };
    return {
      state: {
        ...replace(state, key, { ...reader, loading: false }),
        epochs: { ...state.epochs, [lane]: event.epoch + 1 },
      },
      accepted: true,
    };
  }
  if (event.type === "content.start")
    return {
      state: {
        ...replace(state, key, { ...reader, loading: true, error: undefined }),
        epochs: { ...state.epochs, [epochKey(event.address, "content")]: event.epoch },
      },
      accepted: true,
    };
  if (event.type === "resources.start")
    return {
      state: {
        ...replace(state, key, {
          ...reader,
          resourceLevel: "list",
          resourceLoading: true,
          error: undefined,
        }),
        epochs: { ...state.epochs, [epochKey(event.address, "resources")]: event.epoch },
      },
      accepted: true,
    };
  if (event.type === "resource.start")
    return {
      state: {
        ...replace(state, key, {
          ...reader,
          selectedResource: event.path,
          resource: undefined,
          resourceLevel: "content",
          resourceLoading: true,
          error: undefined,
        }),
        epochs: { ...state.epochs, [epochKey(event.address, "resource")]: event.epoch },
      },
      accepted: true,
    };
  const request =
    event.type === "content.settle"
      ? "content"
      : event.type === "resources.settle"
        ? "resources"
        : event.type === "resource.settle"
          ? "resource"
          : event.request;
  if (state.epochs[epochKey(event.address, request)] !== event.epoch)
    return { state, accepted: false };
  if (event.type === "content.settle")
    return {
      state: replace(state, key, {
        ...reader,
        text: event.value.markdownText,
        rawText: event.value.rawText,
        loading: false,
        error: undefined,
      }),
      accepted: true,
    };
  if (event.type === "resources.settle")
    return {
      state: replace(state, key, {
        ...reader,
        resources: event.resources,
        resourcesLoaded: true,
        resourceLoading: false,
        error: undefined,
      }),
      accepted: true,
    };
  if (event.type === "resource.settle")
    return {
      state: replace(state, key, {
        ...reader,
        selectedResource: event.value.path,
        resource: event.value,
        resourceLevel: "content",
        resourceLoading: false,
        error: undefined,
      }),
      accepted: true,
    };
  return {
    state: replace(state, key, {
      ...reader,
      ...(request === "content" ? { loading: false } : { resourceLoading: false }),
      error: event.diagnostic,
    }),
    accepted: true,
  };
}

export function reduceReaderState(state: ReaderOwnerState, event: ReaderEvent): ReaderOwnerState {
  return reduceReaderEvent(state, event).state;
}
