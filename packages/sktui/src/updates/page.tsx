/** @jsxImportSource @opentui/solid */
import { ObjectMenu } from "../object-menu";
import {
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type BoxRenderable,
  type BaseRenderable,
  Renderable,
} from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { FocusRegistry } from "../focus";
import { isPlainNavKey, matchesCommandShortcut, type NavKey } from "../navigation";
import { usePageReturn } from "../page-navigation";
import type {
  CommandExecution,
  CommandRecord,
  CommandRegistration,
  DispatchResult,
  FocusOwner,
} from "../types";
import { Button } from "../ui/button";
import { DataTable, type DataTableColumn } from "../ui/data-table";
import { Input } from "../ui/input";
import { Pane } from "../ui/pane";
import { Notice } from "../ui/notice";
import { useTheme } from "../ui/use-theme";
import type { UpdateAddress } from "./scope";
import type { UpdateRun, UpdatesState } from "./state";
import { updateFeedback, type UpdateFeedback } from "./feedback";
import { SkillUpdatePreview, type UpdatePreviewRequest } from "./preview";

interface UpdateSkill {
  readonly address: UpdateAddress;
  readonly name: string;
  readonly description: string;
}
export interface UpdatesPageProps {
  readonly environment?: import("@skctl/core").CoreOptions;
  readonly state: UpdatesState;
  readonly skills?: readonly UpdateSkill[];
  readonly onCheck: (sources?: readonly string[]) => void;
  readonly onUpdate: (addresses: readonly UpdateAddress[]) => void;
  readonly onStop: () => void;
  readonly onRetry?: () => void;
  readonly onOpenSource?: (source: string) => void;
  readonly previewUpdate?: typeof import("@skctl/core").previewUpdate;
  readonly onInspectSkill?: (address: UpdateAddress) => void;
  readonly onInspectSource?: (source: string) => void;
  readonly active?: () => boolean;
  readonly run?: () => UpdateRun | undefined;
  readonly checkingActive?: () => boolean;
  readonly checkWarning?: () => string | undefined;
  readonly onStopChecking?: () => void;
  readonly focusRegistry?: FocusRegistry;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
}
export interface SourceUpdatesPageProps extends UpdatesPageProps {
  readonly source: string;
  readonly skills: readonly UpdateSkill[];
  readonly query: string;
  readonly filter: "all" | "updates";
  readonly onQuery: (value: string) => void;
  readonly onFilter: (value: "all" | "updates") => void;
  readonly onSourceDetails: () => void;
}
const addressKey = (address: UpdateAddress) => `${address.source}\u0000${address.path}`;
type BrowserPosition = {
  key?: string;
  scrollTop: number;
};
/** Source overview and Source drill-down share feedback and action primitives. */
export function UpdatesPage(props: UpdatesPageProps) {
  return <UpdateWorkbench {...props} />;
}
export function SourceUpdatesPage(props: SourceUpdatesPageProps) {
  return <UpdateWorkbench {...props} sourceView={props} />;
}
function UpdateWorkbench(
  props: UpdatesPageProps & {
    readonly sourceView?: SourceUpdatesPageProps;
  },
) {
  const terminal = useTerminalDimensions();
  const renderer = useRenderer();
  const theme = useTheme();
  const source = () => props.sourceView?.source;
  const prefix = source() ? "source-updates" : "updates";
  let workbench: BoxRenderable | undefined;
  let browser: BoxRenderable | undefined;
  let input: InputRenderable | undefined;
  let actionPane: BoxRenderable | undefined;
  const [actionWidth, setActionWidth] = createSignal(0);
  const shortActions = () => (actionWidth() || terminal().width - 6) < 66;
  let feedbackReader: ScrollBoxRenderable | undefined;
  const [detailSnapshot, setDetailSnapshot] = createSignal<UpdateFeedback>();
  const [preview, setPreview] = createSignal<{
    readonly request: UpdatePreviewRequest;
    readonly unavailableReason?: string;
  }>();
  let previewStart: BrowserPosition | undefined;
  let detailStart: BrowserPosition | undefined;
  let restoreSearchFrame: (() => void) | undefined;
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchDraft, setSearchDraft] = createSignal("");
  let searchStart: BrowserPosition | undefined;
  onCleanup(() => {
    if (restoreSearchFrame) renderer.off("frame", restoreSearchFrame);
  });
  const compact = () => terminal().height < 24;
  const active = () => props.active?.() ?? false;
  const run = () => props.run?.();
  const committedQuery = () => props.sourceView?.query ?? props.state.query();
  const query = () => (searchOpen() ? searchDraft() : committedQuery());
  const scope = createMemo(() => props.state.scope);
  const targets = createMemo(() =>
    scope().addresses.filter((address) => !source() || address.source === source()),
  );
  const allowed = createMemo(() => new Set(targets().map(addressKey)));
  const healthy = createMemo(
    () =>
      new Set(
        scope()
          .observed.filter((item) => item.owner.health === "healthy")
          .map((item) => addressKey(item.address)),
      ),
  );
  const selected = createMemo(() =>
    props.state.selected().filter((address) => allowed().has(addressKey(address))),
  );
  const selectedKeys = createMemo(() => new Set(selected().map(addressKey)));
  const results = createMemo(
    () => new Map(run()?.results.map((result) => [addressKey(result.address), result]) ?? []),
  );
  const allSkills = createMemo(() => {
    const entries = new Map(
      (props.skills ?? []).map((skill) => [addressKey(skill.address), skill]),
    );
    for (const group of props.state.groups())
      for (const skill of [
        ...(group.observation?.changed ?? []),
        ...(group.observation?.unchanged ?? []),
      ]) {
        const address = { source: group.source, path: skill.path };
        if (!entries.has(addressKey(address)))
          entries.set(addressKey(address), { ...skill, address });
      }
    return targets().map(
      (address) =>
        entries.get(addressKey(address)) ?? { address, name: address.path || ".", description: "" },
    );
  });
  const statuses = createMemo(
    () =>
      new Map<string, string>(
        allSkills().map((skill) => {
          const key = addressKey(skill.address);
          const task = run();
          const result = results().get(key);
          if (result && result.status !== "not-run")
            return [
              key,
              result.status === "updated"
                ? "Updated"
                : result.status === "unchanged"
                  ? "Up to date"
                  : result.status === "unknown"
                    ? "Verify result"
                    : "Needs attention",
            ];
          if (result && task?.phase !== "settled")
            return [
              key,
              task?.source === skill.address.source
                ? task.phase === "updating"
                  ? "Updating"
                  : task.phase === "stopping"
                    ? "Stopping"
                    : "Checking"
                : "Waiting",
            ];
          if (result?.status === "not-run") return [key, "Not run"];
          const group = props.state.group(skill.address.source);
          if (group?.status === "checking") return [key, "Checking"];
          if (group?.status === "failed" || group?.status === "cancelled")
            return [key, "Check needed"];
          if (!group?.observation) return [key, "Not checked"];
          if (group.stale || group.status === "succeeded") return [key, "Check needed"];
          if (group.observation.changed.some((item) => item.path === skill.address.path))
            return [key, "Update available"];
          if (group.observation.removed.some((item) => item.path === skill.address.path))
            return [key, "Removed upstream"];
          return [
            key,
            group.observation.unchanged.some((item) => item.path === skill.address.path)
              ? "Up to date"
              : "No check result",
          ];
        }),
      ),
  );
  const sourceRows = createMemo(() =>
    scope()
      .sources.map((id) => {
        const addresses = targets().filter((address) => address.source === id);
        const labels = addresses.map((address) => statuses().get(addressKey(address)));
        const status = labels.includes("Updating")
          ? "Updating"
          : labels.includes("Stopping")
            ? "Stopping"
            : labels.includes("Checking")
              ? "Checking"
              : labels.some((label) =>
                    [
                      "Needs attention",
                      "Verify result",
                      "Removed upstream",
                      "No check result",
                    ].includes(label ?? ""),
                  )
                ? "Needs attention"
                : labels.includes("Not run")
                  ? "Not run"
                  : labels.includes("Waiting")
                    ? "Waiting"
                    : labels.includes("Check needed")
                      ? "Check needed"
                      : labels.includes("Not checked")
                        ? "Not checked"
                        : labels.includes("Update available")
                          ? "Updates available"
                          : labels.includes("Updated")
                            ? "Updated"
                            : "Up to date";
        const group = props.state.group(id);
        const changed = new Set(
          group ? props.state.scopedChanged(group).map((skill) => skill.path) : [],
        );
        const updates = addresses.filter(
          (address) =>
            changed.has(address.path) &&
            !["updated", "unchanged"].includes(results().get(addressKey(address))?.status ?? ""),
        ).length;
        return {
          source: id,
          addresses,
          installed: addresses.length,
          updates,
          selected: addresses.filter((address) => selectedKeys().has(addressKey(address))).length,
          status,
        };
      })
      .filter((row) => row.addresses.length),
  );
  const visibleSources = createMemo(() =>
    sourceRows()
      .filter((row) => row.source.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase()))
      .sort((a, b) => sourcePriority(a.status) - sourcePriority(b.status)),
  );
  const visibleSkills = createMemo(() =>
    allSkills().filter((skill) => {
      const needle = query().trim().toLocaleLowerCase();
      return (
        (props.sourceView?.filter === "all" ||
          statuses().get(addressKey(skill.address)) !== "Up to date" ||
          selectedKeys().has(addressKey(skill.address))) &&
        (!needle ||
          `${skill.name} ${skill.description} ${skill.address.path}`
            .toLocaleLowerCase()
            .includes(needle))
      );
    }),
  );
  const visibleKeys = createMemo(
    () =>
      new Set(
        source()
          ? visibleSkills().map((skill) => addressKey(skill.address))
          : visibleSources().flatMap((row) => row.addresses.map(addressKey)),
      ),
  );
  const hiddenSelected = createMemo(
    () => selected().filter((address) => !visibleKeys().has(addressKey(address))).length,
  );
  const currentSource = createMemo(
    () =>
      visibleSources().find((row) => row.source === props.state.focusedRowKey()) ??
      visibleSources()[0],
  );
  const currentSkillKey = () => props.state.sourcePosition(source()!)?.currentKey;
  const capturePosition = (): BrowserPosition => ({
    key: source() ? currentSkillKey() : props.state.focusedRowKey(),
    scrollTop: source()
      ? (props.state.sourcePosition(source()!)?.scrollTop ?? 0)
      : props.state.browserScroll(),
  });
  const restorePosition = (position: BrowserPosition) => {
    if (source())
      props.state.setSourcePosition(source()!, {
        currentKey: position.key,
        scrollTop: position.scrollTop,
      });
    else {
      props.state.setFocusedRowKey(position.key);
      props.state.setBrowserScroll(position.scrollTop);
    }
  };
  const currentSkill = createMemo(
    () =>
      visibleSkills().find((skill) => addressKey(skill.address) === currentSkillKey()) ??
      visibleSkills()[0],
  );
  const currentTargets = () =>
    source()
      ? currentSkill()
        ? [currentSkill()!.address]
        : []
      : (currentSource()?.addresses ?? []);
  const updateCurrent = () => {
    if (searchOpen()) closeSearch(false);
    if (!active() && currentTargets().length) props.onUpdate([...currentTargets()]);
  };
  const updatePrimary = () => {
    if (searchOpen()) closeSearch(false);
    if (!active() && !scope().unavailableReason && targets().length)
      props.onUpdate(selected().length ? selected() : [...targets()]);
  };
  const clearSelection = () => props.state.completeSelection(selected());
  const toggleSource = (row: ReturnType<typeof sourceRows>[number]) => {
    const checked = row.addresses.filter((address) => selectedKeys().has(addressKey(address)));
    batch(() => {
      if (checked.length) props.state.completeSelection(checked);
      else row.addresses.forEach((address) => props.state.toggle(address));
    });
  };
  const sourceColumns = createMemo<
    readonly DataTableColumn<ReturnType<typeof sourceRows>[number]>[]
  >(() => [
    {
      id: "source",
      header: "Source",
      minWidth: 10,
      maxWidth: sourceRows().reduce(
        (width, row) => Math.max(width, Math.min(42, Bun.stringWidth(row.source))),
        10,
      ),
      cell: (row) => row.source,
    },
    {
      id: "updates",
      header: "Updates",
      width: 7,
      align: "right",
      optional: true,
      cell: (row) => ({
        text: [
          "Not checked",
          "Checking",
          "Check needed",
          "Waiting",
          "Needs attention",
          "Not run",
        ].includes(row.status)
          ? "—"
          : String(row.updates),
        tone: row.status === "Updates available" ? "warning" : "muted",
      }),
    },
    {
      id: "status",
      header: "Status",
      width: 17,
      cell: (row) => ({
        text: row.status,
        tone:
          sourcePriority(row.status) === 2
            ? "warning"
            : row.status === "Up to date" || row.status === "Not checked"
              ? "muted"
              : "neutral",
      }),
    },
    {
      id: "installed",
      header: "Installed",
      width: 9,
      align: "right",
      optional: true,
      cell: (row) => ({ text: String(row.installed), tone: "muted" }),
    },
    ...(selected().length
      ? [
          {
            id: "selected",
            header: "Selected",
            width: 8,
            align: "right" as const,
            optional: true,
            cell: (row: ReturnType<typeof sourceRows>[number]) => String(row.selected),
          },
        ]
      : []),
  ]);
  const skillColumns = createMemo<readonly DataTableColumn<UpdateSkill>[]>(() => [
    {
      id: "skill",
      header: "Skill",
      minWidth: 8,
      maxWidth: allSkills().reduce(
        (width, skill) => Math.max(width, Math.min(42, Bun.stringWidth(skill.name))),
        8,
      ),
      cell: (skill) => skill.name,
    },
    {
      id: "status",
      header: "Status",
      width: 17,
      cell: (skill: UpdateSkill) => statuses().get(addressKey(skill.address)) ?? "Not checked",
    },
  ]);
  const bind = (owner: FocusOwner, target: Renderable) => {
    const dispose = props.focusRegistry?.register(owner, target);
    target.once("destroyed", () => dispose?.());
    onCleanup(() => dispose?.());
  };
  const keyHandler = (key: NavKey): DispatchResult => {
    // Isolated workspaces use the same definitions as App's shared dispatcher.
    if (!props.registerCommand) {
      const direct = commands().find((command) => matchesCommandShortcut(command.record, key));
      if (direct) {
        if (!direct.record.enabled)
          return { kind: "blocked", reason: direct.record.disabledReason ?? "Unavailable" };
        direct.execute();
        return "consumed";
      }
    }
    if (!isPlainNavKey(key)) return "declined";
    if (key.name === "left" || key.name === "right") return "consumed";
    return "declined";
  };
  const reason = () =>
    scope().unavailableReason ??
    (active()
      ? "An update is running"
      : targets().length
        ? undefined
        : "No installed Skills in this scope");
  const primaryLabel = () =>
    selected().length ? `Update selected ${selected().length}` : "Update all";
  const actionProps = {
    get focusRegistry() {
      return props.focusRegistry;
    },
    onKey: (key: NavKey): DispatchResult => {
      if (
        detailSnapshot() &&
        !preview() &&
        isPlainNavKey(key) &&
        (key.name === "escape" || key.char === "d")
      ) {
        closeDetails();
        return "consumed";
      }
      return ["left", "right", "up", "down"].includes(key.name) ? "declined" : keyHandler(key);
    },
  };
  const feedback = createMemo(() => updateFeedback(targets(), props.state.groups(), run()));
  const preferredFeedback = createMemo(() => {
    if (source()) {
      const current = currentSkill();
      return (
        feedback().find(
          (item) =>
            item.address && current && addressKey(item.address) === addressKey(current.address),
        ) ?? feedback().find((item) => item.source === source() && !item.uncertain)
      );
    }
    return feedback().find((item) => item.source === currentSource()?.source) ?? feedback()[0];
  });
  const shownFeedback = () => detailSnapshot() ?? preferredFeedback();
  const feedbackTarget = (item: UpdateFeedback) => {
    if (!item.address) return item.source;
    const path = item.address.path || ".";
    const name = allSkills().find(
      (skill) => addressKey(skill.address) === addressKey(item.address!),
    )?.name;
    return `${item.source} / ${path}${name && name !== path ? ` (${name})` : ""}`;
  };
  const restoreViewport = (scrollTop: number) => {
    if (restoreSearchFrame) renderer.off("frame", restoreSearchFrame);
    restoreSearchFrame = () => {
      restoreSearchFrame = undefined;
      if (!browser || browser.isDestroyed) return;
      const body = browser.findDescendantById(`${prefix}-browser-body`);
      if (body instanceof ScrollBoxRenderable) body.scrollTo(scrollTop);
    };
    renderer.once("frame", restoreSearchFrame);
    renderer.requestRender();
  };
  const closeDetails = () => {
    const start = detailStart;
    batch(() => {
      setDetailSnapshot(undefined);
      if (start) restorePosition(start);
    });
    queueMicrotask(() => browser?.focus());
    if (start) restoreViewport(start.scrollTop);
  };
  const sharedReturn = usePageReturn(() =>
    detailSnapshot() && !preview()
      ? {
          record: {
            id: `${prefix}.feedback-details`,
            verb: "Back to updates",
            destination: source() ? `Skill updates for ${source()}` : "Sources in Updates",
            keys: ["enter"],
            shortcut: "d",
            scope: "page",
            enabled: true,
            danger: false,
          },
          anchor: () => workbench,
          execute: closeDetails,
        }
      : undefined,
  );
  const openPreview = (address: UpdateAddress) => {
    const group = props.state.group(address.source);
    const observation = group?.observation;
    previewStart = capturePosition();
    setPreview({
      request: {
        source: address.source,
        path: address.path,
        exactRevision: observation?.exactRevision,
        expectedBaseline: observation?.baseline ?? "",
      },
      unavailableReason:
        !observation?.baseline || group?.stale
          ? "Check updates again before previewing this Skill."
          : active()
            ? "An update is running. Return to updates and wait for it to finish before previewing."
            : undefined,
    });
  };
  const closePreview = () => {
    const start = previewStart;
    setPreview(undefined);
    queueMicrotask(() => {
      if (browser?.isDestroyed) return;
      browser?.focus();
      if (start) restoreViewport(start.scrollTop);
    });
  };
  const toggleDetails = () => {
    if (detailSnapshot()) closeDetails();
    else if (preferredFeedback()) {
      if (searchOpen()) closeSearch(false);
      detailStart = capturePosition();
      setDetailSnapshot(preferredFeedback());
      queueMicrotask(() => feedbackReader?.focus());
    }
  };
  const currentLabel = () => (source() ? "Update Skill" : "Update Source");
  const openSearch = () => {
    if (!searchOpen()) {
      searchStart = capturePosition();
      setSearchDraft(committedQuery());
      setSearchOpen(true);
    }
    queueMicrotask(() => {
      if (searchOpen() && !input?.isDestroyed) input?.focus();
    });
  };
  const closeSearch = (cancel: boolean) => {
    const start = searchStart;
    batch(() => {
      if (!cancel) {
        if (props.sourceView) props.sourceView.onQuery(searchDraft());
        else props.state.setQuery(searchDraft());
      }
      setSearchOpen(false);
      if (cancel && start) restorePosition(start);
    });
    browser?.focus();
    if (cancel && start) {
      restoreViewport(start.scrollTop);
    }
  };
  const context = createMemo(() => {
    return (
      [
        (compact() && preferredFeedback()
          ? `${preferredFeedback()!.title}: ${feedbackTarget(preferredFeedback()!)}`
          : undefined) ??
          (source()
            ? props.sourceView?.filter === "all"
              ? "All Skills"
              : "Updates only"
            : undefined),
        !searchOpen() && committedQuery() ? `Filter: ${committedQuery()}` : undefined,
      ]
        .filter(Boolean)
        .join(". ") || undefined
    );
  });
  const selectionProps = {
    get keys() {
      return selectedKeys();
    },
    get showIndicators() {
      return !!selected().length;
    },
    canSelect: (skill: UpdateSkill) => !active() && healthy().has(addressKey(skill.address)),
    onToggle: (skill: UpdateSkill) => props.state.toggle(skill.address),
  };
  const registerBrowser = (target: BoxRenderable) => {
    browser = target;
    bind("browser", target);
    bind("work-area", target);
  };
  const commands = createMemo(() => {
    const command = (
      id: string,
      verb: string,
      execute: () => void,
      options: {
        shortcut?: string;
        destination?: string;
        reason?: string;
        palette?: boolean;
      } = {},
    ) => ({
      record: {
        id: `${prefix}.${id}`,
        keys: ["enter", "return"],
        scope: "page",
        verb,
        destination: options.destination ?? "",
        shortcut: options.shortcut,
        enabled: !options.reason,
        disabledReason: options.reason,
        danger: false,
        ...(options.palette === false ? { palette: false } : {}),
      } satisfies CommandRecord,
      execute,
    });
    const records = [
      command("update-all", primaryLabel(), updatePrimary, {
        shortcut: "Ctrl+U",
        reason: reason(),
        destination: `${selected().length || targets().length} ${selected().length ? "selected" : "installed"} Skills in ${source() ?? scopeLabel(props.state)}${hiddenSelected() ? `. Includes ${hiddenSelected()} hidden selections` : ""}`,
      }),
      command(source() ? "update-skill" : "update-source", currentLabel(), updateCurrent, {
        shortcut: "u",
        reason: active()
          ? "An update is running"
          : currentTargets().length
            ? scope().unavailableReason
            : "No current item",
        destination: source()
          ? `${source()}/${currentSkill()?.address.path ?? ""}`
          : `${currentTargets().length} Skills in ${currentSource()?.source ?? "No Source"}`,
      }),
      command(
        "check",
        source() ? "Recheck Source" : "Recheck Sources",
        () => props.onCheck(source() ? [source()!] : scope().sources),
        {
          shortcut: "r",
          reason: active()
            ? "An update is running"
            : scope().sources.length
              ? undefined
              : "No Sources in this scope",
          destination: source() ?? `${scope().sources.length} Sources in this scope`,
        },
      ),
      command("filter", source() ? "Filter Skills" : "Filter Sources", openSearch, {
        shortcut: "/",
        destination: "Type a filter. Enter applies; Esc cancels.",
      }),
      command(
        "select",
        source() ? "Select current Skill" : "Select current Source",
        () => {
          if (source() && currentSkill()) props.state.toggle(currentSkill()!.address);
          else if (currentSource()) toggleSource(currentSource()!);
        },
        {
          shortcut: "Space",
          reason: active()
            ? "An update is running"
            : currentTargets().some((address) => healthy().has(addressKey(address)))
              ? undefined
              : "No selectable item",
          destination: source()
            ? `Toggle ${source()}/${currentSkill()?.address.path ?? ""} in the update batch`
            : `Select ${currentTargets().length} bounded Skills in ${currentSource()?.source ?? "No Source"}`,
        },
      ),
      command("clear", "Clear selection", clearSelection, {
        reason: selected().length ? undefined : "No selected Skills",
        destination: "Keep the current item and filter",
      }),
    ];
    const notice = shownFeedback();
    if (notice) {
      const inspectSkill =
        notice.recovery === "inspect-skill" && notice.address && props.onInspectSkill;
      records.push(
        command(
          "feedback-recover",
          inspectSkill
            ? "Inspect Skill"
            : notice.recovery === "recheck"
              ? "Recheck Source"
              : "Open Source",
          () => {
            if (inspectSkill && notice.address) props.onInspectSkill?.(notice.address);
            else if (notice.recovery === "recheck") props.onCheck([notice.source]);
            else props.onInspectSource?.(notice.source);
          },
          {
            destination: feedbackTarget(notice),
            reason:
              notice.recovery === "recheck"
                ? active()
                  ? "An update is running"
                  : undefined
                : inspectSkill || props.onInspectSource
                  ? undefined
                  : notice.recovery === "inspect-skill"
                    ? "Skill and Source inspection unavailable"
                    : "Source inspection unavailable",
          },
        ),
      );
      if (!detailSnapshot() || !sharedReturn)
        records.push(
          command(
            "feedback-details",
            detailSnapshot() ? "Back to list" : "Details",
            toggleDetails,
            {
              shortcut: "d",
              destination: `Read diagnostics for ${feedbackTarget(notice)}`,
            },
          ),
        );
    }
    if (source())
      records.push(
        command(
          "show-all",
          props.sourceView?.filter === "all" ? "Show updates only" : "Show all Skills",
          () => props.sourceView?.onFilter(props.sourceView.filter === "all" ? "updates" : "all"),
          {
            destination: `Change the visible Skills in ${source()}. The update scope stays the same.`,
          },
        ),
        command(
          "source-details",
          "Open Source details",
          () => props.sourceView?.onSourceDetails(),
          { destination: source() },
        ),
      );
    if (active())
      records.push(
        command(
          "stop",
          "Stop update",
          () => {
            // Move before Stop becomes disabled and loses its native focus.
            browser?.focus();
            props.onStop();
          },
          {
            palette: false,
            shortcut: "s",
            destination: "Stop pending work; completed updates remain published",
            reason:
              run()?.phase === "stopping"
                ? "Stopping; waiting for the current operation"
                : undefined,
          },
        ),
      );
    if (props.checkingActive?.() && !active())
      records.push(
        command("stop-checking", "Stop checks", () => props.onStopChecking?.(), {
          palette: false,
          destination: "Cancel outstanding Source checks",
        }),
      );
    if (run()?.phase === "settled" && run()?.results.some((result) => result.status === "not-run"))
      records.push(
        command("retry", "Continue not-run", () => props.onRetry?.(), {
          destination: "Only targets that did not run; unknown outcomes are excluded",
        }),
      );
    return records;
  });
  const action = (id: string) =>
    commands().find((command) => command.record.id === `${prefix}.${id}`)!;
  const toolbarActions = createMemo(() => {
    if (!active() && props.checkingActive?.()) return ["stop-checking"];
    if (run()?.phase === "settled" && run()?.results.some((result) => result.status === "not-run"))
      return ["retry", ...(shownFeedback() ? ["feedback-recover"] : [])];
    if (detailSnapshot() || (compact() && preferredFeedback()))
      return [
        ...(!active() ? ["feedback-recover"] : []),
        ...(!detailSnapshot() || !sharedReturn ? ["feedback-details"] : []),
        ...(active() ? ["stop"] : []),
      ];
    if (active()) return ["stop"];
    if (shortActions()) return ["update-all"];
    return [
      "update-all",
      selected().length ? "clear" : source() ? "update-skill" : "update-source",
      source() ? "show-all" : "check",
    ];
  });
  const overflowActions = () =>
    shortActions() &&
    !active() &&
    !detailSnapshot() &&
    !(compact() && preferredFeedback()) &&
    !props.checkingActive?.() &&
    !toolbarActions().includes("retry")
      ? [
          action(source() ? "update-skill" : "update-source"),
          action(source() ? "show-all" : "check"),
          ...(selected().length ? [action("clear")] : []),
        ]
      : [];
  const shortActionLabel = (id: string) => {
    if (!shortActions()) return undefined;
    return action(id).record.verb;
  };
  createEffect(() => {
    if (preview()) return;
    for (const command of commands()) {
      const dispose = props.registerCommand?.(
        command.record,
        `command:${command.record.id}`,
        command.record.id.replace(".", "-"),
        command.execute,
      );
      onCleanup(() => dispose?.());
    }
  });
  const TaskControls = () => (
    <Show
      when={searchOpen()}
      fallback={
        <box
          id={`${prefix}-actions-pane`}
          flexDirection="row"
          height={1}
          flexShrink={0}
          columnGap={1}
          ref={(target) => {
            actionPane = target;
            setActionWidth(target.width);
          }}
          onSizeChange={() => setActionWidth(actionPane?.width ?? 0)}
        >
          <For each={toolbarActions()}>
            {(id) => (
              <UpdateAction
                {...actionProps}
                command={action(id)}
                label={shortActionLabel(id)}
                primary={id === "update-all" || id === "stop"}
              />
            )}
          </For>
          <ObjectMenu
            id={`${prefix}-more`}
            target={`${source() ?? "overview"}:${currentSkillKey() ?? currentSource()?.source ?? ""}`}
            commands={overflowActions()}
            focusRegistry={props.focusRegistry}
            registerCommand={props.registerCommand}
          />
        </box>
      }
    >
      <box id={`${prefix}-query-pane`} height={1} flexShrink={0} flexDirection="row">
        <text height={1} flexShrink={0} fg={theme().colors.mutedForeground}>
          Filter:{" "}
        </text>
        <Input
          id={`${prefix}-query`}
          value={searchDraft()}
          onInput={setSearchDraft}
          flexGrow={1}
          placeholder={source() ? "Filter Skills" : "Filter Sources"}
          ref={(target) => {
            input = target;
            const owner = source() ? "source-updates-query" : "updates-query";
            bind(owner, target);
            const disposeCommand = props.registerCommand?.(
              {
                id: `${prefix}.apply-filter`,
                verb: "Apply filter",
                destination: "Keep this filter and return to the list",
                keys: ["enter"],
                scope: "widget",
                enabled: true,
                danger: false,
              },
              owner,
              target.id,
              () => closeSearch(false),
            );
            onCleanup(() => disposeCommand?.());
            const dispose = props.focusRegistry?.registerModeHandler(target, (key) => {
              if (isPlainNavKey(key) && ["enter", "down", "escape"].includes(key.name)) {
                closeSearch(key.name === "escape");
                return "consumed";
              }
              return "declined";
            });
            target.once("destroyed", () => dispose?.());
          }}
        />
      </box>
    </Show>
  );
  return (
    <Pane
      id={`${prefix}-page`}
      title={
        preview() ? "Skill changes" : detailSnapshot() ? "Update details" : (source() ?? "Sources")
      }
      description={preview() ? "Read-only preview" : context()}
    >
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        <box
          flexDirection="column"
          flexGrow={1}
          minHeight={0}
          visible={!preview()}
          ref={(target) => {
            workbench = target;
          }}
        >
          <TaskControls />
          <Show when={!compact()}>
            <Show
              when={
                scope().entry.kind === "collection" ||
                scope().entry.kind === "skill" ||
                scope().entry.kind === "selected"
              }
            >
              <text
                height={1}
                flexShrink={0}
                wrapMode="none"
                fg={theme().colors.mutedForeground}
                content={scopeLabel(props.state)}
              />
            </Show>
          </Show>
          <box
            id={`${prefix}-data-pane`}
            visible={!detailSnapshot()}
            flexGrow={1}
            minHeight={0}
            marginTop={terminal().height >= 24 ? 1 : 0}
          >
            <Show
              when={source()}
              fallback={
                <DataTable
                  id="updates-browser"
                  rows={visibleSources()}
                  columns={sourceColumns()}
                  rowKey={(row) => row.source}
                  currentKey={props.state.focusedRowKey()}
                  onCurrentChange={props.state.setFocusedRowKey}
                  onActivate={(row) => {
                    if (searchOpen()) closeSearch(false);
                    props.onOpenSource?.(row.source);
                  }}
                  onKey={keyHandler}
                  selection={{
                    get keys() {
                      return new Set(
                        sourceRows()
                          .filter((row) => row.selected)
                          .map((row) => row.source),
                      );
                    },
                    get showIndicators() {
                      return !!selected().length;
                    },
                    canSelect: (row) =>
                      !active() &&
                      row.addresses.some((address) => healthy().has(addressKey(address))),
                    onToggle: toggleSource,
                  }}
                  initialScrollTop={props.state.browserScroll()}
                  onScroll={props.state.setBrowserScroll}
                  focusRegistry={props.focusRegistry}
                  emptyText={
                    query() ? "No Sources match this search" : "No installed Skills in this scope"
                  }
                  ref={registerBrowser}
                />
              }
            >
              <DataTable
                id="source-updates-browser"
                rows={visibleSkills()}
                columns={skillColumns()}
                rowKey={(skill) => addressKey(skill.address)}
                currentKey={currentSkillKey()}
                onCurrentChange={(currentKey) =>
                  props.state.setSourcePosition(source()!, {
                    currentKey,
                    scrollTop: props.state.sourcePosition(source()!)?.scrollTop ?? 0,
                  })
                }
                onActivate={(skill) => {
                  if (searchOpen()) closeSearch(false);
                  openPreview(skill.address);
                }}
                onKey={keyHandler}
                selection={selectionProps}
                initialScrollTop={props.state.sourcePosition(source()!)?.scrollTop ?? 0}
                onScroll={(scrollTop) =>
                  props.state.setSourcePosition(source()!, {
                    currentKey: currentSkillKey(),
                    scrollTop,
                  })
                }
                focusRegistry={props.focusRegistry}
                emptyText={query() ? "No Skills match this search" : "No updates available"}
                ref={registerBrowser}
              />
            </Show>
          </box>
          <Show when={hiddenSelected() && !compact() && !detailSnapshot()}>
            <text
              height={1}
              flexShrink={0}
              wrapMode="none"
              fg={theme().colors.mutedForeground}
            >{`${hiddenSelected()} selected Skills hidden by this view`}</text>
          </Show>
          <Show
            when={!detailSnapshot() && !compact() && !searchOpen() && preferredFeedback()}
            keyed
          >
            {(notice) => (
              <Notice
                id={`${prefix}-notice`}
                title={notice.title}
                target={feedbackTarget(notice)}
                body={notice.body}
              >
                <UpdateAction {...actionProps} command={action("feedback-recover")} />
                <UpdateAction {...actionProps} command={action("feedback-details")} />
              </Notice>
            )}
          </Show>
          <Show when={detailSnapshot()} keyed>
            {(notice) => (
              <>
                <text
                  height={1}
                  flexShrink={0}
                  fg={theme().colors.warning}
                  wrapMode="none"
                >{`${notice.title}: ${feedbackTarget(notice)}`}</text>
                <scrollbox
                  id={`${prefix}-feedback-pane`}
                  flexGrow={1}
                  minHeight={1}
                  scrollX={false}
                  focusable
                  ref={(target) => {
                    feedbackReader = target;
                    bind("problems", target);
                    const dispose = props.focusRegistry?.registerModeHandler(target, (key) => {
                      if (!isPlainNavKey(key)) return "declined";
                      // Native text can reserve an extra trailing layout row. Bound
                      // keyboard scrolling by painted lines, including in a one-row viewport.
                      const rows = target
                        .getChildren()
                        .reduce(
                          (bottom, child) =>
                            Math.max(
                              bottom,
                              child.y -
                                target.content.y +
                                (child instanceof TextRenderable
                                  ? child.virtualLineCount
                                  : child.height),
                            ),
                          0,
                        );
                      const last = Math.max(0, rows - target.viewport.height);
                      if (key.name === "escape" || key.char === "d") closeDetails();
                      else if (key.name === "home") target.scrollTo(0);
                      else if (key.name === "end") target.scrollTo(last);
                      else if (["up", "down", "page-up", "page-down"].includes(key.name))
                        target.scrollBy(
                          key.name === "up" || key.name === "page-up" ? -1 : 1,
                          key.name.startsWith("page-") ? "viewport" : "step",
                        );
                      else return "declined";
                      if (target.scrollTop > last) target.scrollTo(last);
                      return "consumed";
                    });
                    onCleanup(() => dispose?.());
                  }}
                >
                  <text wrapMode="word" fg={theme().colors.foreground}>
                    {`${feedbackTarget(notice)}\n\n${notice.detail}`}
                  </text>
                </scrollbox>
              </>
            )}
          </Show>
          <Show when={props.checkWarning?.()}>
            <text height={1} flexShrink={0} wrapMode="none" fg={theme().colors.warning}>
              Checks cannot be saved for next startup
            </text>
          </Show>
        </box>
        <Show when={preview()} keyed>
          {(value) => (
            <SkillUpdatePreview
              request={value.request}
              unavailableReason={value.unavailableReason}
              previewUpdate={props.previewUpdate}
              environment={props.environment}
              prefix={prefix}
              focusRegistry={props.focusRegistry}
              registerCommand={props.registerCommand}
              onBack={closePreview}
            />
          )}
        </Show>
      </box>
    </Pane>
  );
}
function sourcePriority(status: string): number {
  if (["Updates available", "Updating", "Stopping"].includes(status)) return 0;
  if (["Up to date", "Updated"].includes(status)) return 1;
  if (["Needs attention", "Not run"].includes(status)) return 2;
  return 3;
}
/** App dispatch and physical focus wrap the shared TuiParts Button, not styled text. */
function UpdateAction(props: {
  readonly command: {
    readonly record: CommandRecord;
    readonly execute: () => void;
  };
  readonly primary?: boolean;
  readonly label?: string;
  readonly focusRegistry?: FocusRegistry;
  readonly onKey?: (key: NavKey) => DispatchResult;
}) {
  const id = props.command.record.id.replace(".", "-");
  const commandId = props.command.record.id;
  const owner: FocusOwner = `command:${commandId}`;
  const press = () => {
    if (props.command.record.enabled) props.command.execute();
  };
  return (
    <Button
      id={id}
      label={
        props.label ??
        (props.command.record.shortcut
          ? `${props.command.record.shortcut} ${props.command.record.verb}`
          : props.command.record.verb)
      }
      intent={props.primary ? "primary" : "neutral"}
      disabled={!props.command.record.enabled}
      height={1}
      flexShrink={0}
      onPress={press}
      ref={(button) => {
        const unregister = props.focusRegistry?.register(owner, button);
        const mode = props.focusRegistry?.registerModeHandler(button, (key) => {
          const command = props.onKey?.(key);
          if (command && command !== "declined") return command;
          if (!isPlainNavKey(key) || !["left", "right", "up", "down"].includes(key.name))
            return "declined";
          const controls: Renderable[] = [];
          const collect = (target: BaseRenderable) => {
            if (target instanceof Renderable && target.focusable) controls.push(target);
            else for (const child of target.getChildren()) collect(child);
          };
          for (const child of button.parent?.getChildren() ?? []) collect(child);
          const index = controls.indexOf(button);
          controls[
            Math.max(
              0,
              Math.min(
                controls.length - 1,
                index + (key.name === "right" || key.name === "down" ? 1 : -1),
              ),
            )
          ]?.focus();
          return "consumed";
        });
        onCleanup(() => {
          unregister?.();
          mode?.();
        });
      }}
    />
  );
}
function scopeLabel(state: UpdatesState) {
  const entry = state.scope.entry;
  return entry.kind === "collection"
    ? `Collection ${entry.collection}${state.scope.includesReferences ? " (includes References)" : ""}`
    : entry.kind === "selected"
      ? `${entry.addresses.length} selected Skills`
      : entry.kind === "skill"
        ? `${entry.address.source}/${entry.address.path}`
        : "Workspace";
}
