import { SkctlError, type Diagnostic } from "@skctl/core";
import { createSignal, untrack } from "solid-js";
import { skillAddressKey, type ReaderState } from "../types";

export type ReaderAddress = { readonly source: string; readonly path: string };
type ReaderContent = Pick<
  typeof import("@skctl/core"),
  "loadInstalledSkill" | "listInstalledResources" | "readInstalledResource"
>;
type Lane = "content" | "resource";
interface ReaderCache {
  readonly activeKey?: string;
  readonly cache: Readonly<Record<string, ReaderState | undefined>>;
  readonly epochs: Readonly<Record<string, number | undefined>>;
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
const cancelled = (error: unknown) => error instanceof SkctlError && error.code === "CANCELLED";
const diagnostic = (error: unknown): Diagnostic => ({
  code: error instanceof SkctlError ? error.code : "INTERNAL",
  severity: "warning",
  message: error instanceof Error ? error.message : "Operation failed",
});

/** App-owned installed payloads and two independent read transports; no navigation policy. */
export function createReaderOwner(
  content: ReaderContent,
  onAcceptedFailure: () => void = () => {},
  environment: import("@skctl/core").CoreOptions = { cwd: process.cwd() },
) {
  const [snapshot, setSnapshot] = createSignal<ReaderCache>({ cache: {}, epochs: {} });
  const state = () => untrack(snapshot);
  const current = () => {
    const value = snapshot();
    return value.activeKey ? value.cache[value.activeKey] : undefined;
  };
  let closed = false;
  let contentRequest:
    | {
        readonly controller: AbortController;
        readonly address: ReaderAddress;
        readonly epoch: number;
      }
    | undefined;
  let resourceController: AbortController | undefined;
  const laneKey = (address: ReaderAddress, lane: Lane) => `${skillAddressKey(address)}:${lane}`;
  const write = (key: string, value: Partial<ReaderState>, epochs = state().epochs) => {
    const previous = state();
    const reader = previous.cache[key];
    setSnapshot({
      ...previous,
      epochs,
      cache: reader ? { ...previous.cache, [key]: { ...reader, ...value } } : previous.cache,
    });
  };
  const start = (address: ReaderAddress, lane: Lane, value: Partial<ReaderState>) => {
    const key = laneKey(address, lane);
    const epoch = (state().epochs[key] ?? 0) + 1;
    write(skillAddressKey(address), value, { ...state().epochs, [key]: epoch });
    return epoch;
  };
  const accept = (
    address: ReaderAddress,
    lane: Lane,
    epoch: number,
    value: Partial<ReaderState>,
  ) => {
    if (
      closed ||
      !state().cache[skillAddressKey(address)] ||
      state().epochs[laneKey(address, lane)] !== epoch
    )
      return false;
    write(skillAddressKey(address), value);
    return true;
  };
  const failure = (address: ReaderAddress, lane: Lane, epoch: number, error: Diagnostic) => {
    // Capture the accepted-state predicate before synchronous signal subscribers can re-enter.
    const focus =
      state().activeKey === skillAddressKey(address) &&
      state().cache[skillAddressKey(address)]?.resourceLevel === "content";
    if (
      accept(address, lane, epoch, {
        ...(lane === "content" ? { loading: false } : { resourceLoading: false }),
        error,
      }) &&
      focus
    )
      onAcceptedFailure();
  };
  const retireContent = (address: ReaderAddress, epoch: number) => {
    const key = laneKey(address, "content");
    if (state().cache[skillAddressKey(address)] && state().epochs[key] === epoch)
      write(skillAddressKey(address), { loading: false }, { ...state().epochs, [key]: epoch + 1 });
  };
  const cancelContent = () => {
    const request = contentRequest;
    if (!request) return;
    contentRequest = undefined;
    retireContent(request.address, request.epoch);
    request.controller.abort();
  };
  const load = async (address: ReaderAddress) => {
    if (closed) return undefined;
    cancelContent();
    const controller = new AbortController();
    const epoch = start(address, "content", { loading: true, error: undefined });
    const request = { controller, address, epoch };
    contentRequest = request;
    const active = () => !closed && contentRequest === request && !controller.signal.aborted;
    try {
      const value = await content.loadInstalledSkill(
        environment,
        { address },
        { signal: controller.signal },
      );
      if (!active()) return undefined;
      accept(address, "content", epoch, {
        text: value.markdownText,
        rawText: value.rawText,
        loading: false,
        error: undefined,
      });
      return value;
    } catch (error) {
      if (active()) {
        if (cancelled(error)) retireContent(address, epoch);
        else failure(address, "content", epoch, diagnostic(error));
      }
      return undefined;
    } finally {
      if (contentRequest === request) contentRequest = undefined;
    }
  };
  // List/body share a transport and address epoch, but stale promises still return Core results.
  const resource = async <T>(
    address: ReaderAddress,
    initial: Partial<ReaderState>,
    read: (signal: AbortSignal) => Promise<T>,
    settled: (value: T) => Partial<ReaderState>,
  ) => {
    if (closed) return undefined;
    resourceController?.abort();
    const controller = new AbortController();
    resourceController = controller;
    const epoch = start(address, "resource", {
      ...initial,
      resourceLoading: true,
      error: undefined,
    });
    try {
      const value = await read(controller.signal);
      if (!closed) {
        accept(address, "resource", epoch, {
          ...settled(value),
          resourceLoading: false,
          error: undefined,
        });
      }
      return value;
    } catch (error) {
      if (!closed && !cancelled(error)) failure(address, "resource", epoch, diagnostic(error));
      return undefined;
    } finally {
      if (resourceController === controller) resourceController = undefined;
    }
  };
  return {
    current,
    cached: (address: ReaderAddress) => snapshot().cache[skillAddressKey(address)],
    select: (address: ReaderAddress, surface?: "details") => {
      const previous = state();
      const key = skillAddressKey(address);
      const reader = previous.cache[key] ?? initialReader(address);
      setSnapshot({
        ...previous,
        activeKey: key,
        cache: {
          ...previous.cache,
          [key]: surface === "details" ? { ...reader, tab: "details", focus: "reader" } : reader,
        },
      });
    },
    patch: (value: Partial<ReaderState>) => {
      const key = state().activeKey;
      if (key && state().cache[key]) write(key, value);
    },
    restore: (saved: ReaderState) => {
      if (!saved.address) return;
      const previous = state();
      const key = skillAddressKey(saved.address);
      const reader = previous.cache[key] ?? initialReader(saved.address);
      // Route frames own interaction history, never bytes, errors, loading or epochs.
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
      setSnapshot({ ...previous, activeKey: key, cache: { ...previous.cache, [key]: restored } });
    },
    invalidate: (address?: ReaderAddress) => {
      const previous = state();
      const keys = address ? [skillAddressKey(address)] : Object.keys(previous.cache);
      const cache = { ...previous.cache };
      const epochs = { ...previous.epochs };
      let changed = false;
      for (const key of keys) {
        const reader = cache[key];
        if (!reader?.address) continue;
        changed = true;
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
        for (const lane of ["content", "resource"] as const) {
          const key = laneKey(reader.address, lane);
          epochs[key] = (epochs[key] ?? 0) + 1;
        }
      }
      if (changed) setSnapshot({ ...previous, cache, epochs });
    },
    abandonResource: () => {
      const reader = untrack(current);
      const activeKey = state().activeKey;
      if (!reader?.address || !activeKey) return;
      const key = laneKey(reader.address, "resource");
      write(
        activeKey,
        {
          resourceLevel: "list",
          resourceLoading: false,
          error: reader.resourceLoading || reader.tab === "resources" ? undefined : reader.error,
        },
        { ...state().epochs, [key]: (state().epochs[key] ?? 0) + 1 },
      );
    },
    load,
    list: (address: ReaderAddress) =>
      resource(
        address,
        { resourceLevel: "list" },
        (signal) => content.listInstalledResources(environment, { address }, { signal }),
        (resources) => ({ resources, resourcesLoaded: true }),
      ),
    read: (address: ReaderAddress, path: string) =>
      resource(
        address,
        { selectedResource: path, resource: undefined, resourceLevel: "content" },
        (signal) => content.readInstalledResource(environment, { address, path }, { signal }),
        (value) => ({ selectedResource: value.path, resource: value, resourceLevel: "content" }),
      ),
    cancelContent,
    dispose: () => {
      if (closed) return;
      closed = true;
      cancelContent();
      resourceController?.abort();
    },
  };
}
