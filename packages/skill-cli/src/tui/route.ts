import { batch, createSignal, type Accessor } from "solid-js";
import {
  validSections,
  type Destination,
  type FocusOwner,
  type RelationshipReturn,
  type RouteHandoff,
  type Section,
  type WorkspaceSection,
  type ConfigSection,
} from "./types";
import type { WorkspaceState } from "./workspace/state";
import type { ConfigState } from "./config/state";
import type { ReaderState } from "./types";

export interface RouteSnapshot {
  readonly destination: Destination;
  readonly history: readonly Destination[];
  readonly relationshipReturn?: RelationshipReturn;
  readonly contributionReturn?: {
    readonly destination: Destination;
    readonly section: Section;
    readonly selection?: string;
  };
  readonly handoff?: RouteHandoff;
}

export interface RouteTarget {
  readonly destination: Destination;
  readonly section: Section;
  readonly selection?: string;
  readonly handoff?: RouteHandoff;
}

export interface RelationshipTarget extends RouteTarget {
  readonly returnFocus: "inspector" | "details-relationships";
}

const validTarget = (target: RouteTarget) =>
  validSections(target.destination).includes(target.section);
const skillAddress = (address: { readonly source: string; readonly path: string }) =>
  `${address.source}/${address.path}`;

/** Owns route history and delegates page landing to the bounded page owners. */
export function createRoute(
  pages: { readonly workspace: WorkspaceState; readonly config: ConfigState },
  requestFocus: (owner: FocusOwner) => void = () => {},
  dismissOverlay: () => void = () => {},
  reader: Accessor<ReaderState | undefined> = () => undefined,
  selectReader: (
    address: { readonly source: string; readonly path: string },
    surface?: "details",
  ) => void = () => {},
  landWorkspaceSkill: (selection: string | undefined) => void = (selection) =>
    pages.workspace.land("skills", selection),
) {
  const [snapshot, setSnapshot] = createSignal<RouteSnapshot>({
    destination: "workspace",
    history: [],
  });
  const commit = (next: RouteSnapshot, focus: FocusOwner) =>
    batch(() => {
      setSnapshot(next);
      requestFocus(focus);
    });
  const land = (target: RouteTarget) => {
    if (target.destination === "workspace" && target.section === "skills")
      landWorkspaceSkill(target.selection);
    else if (target.destination === "workspace")
      pages.workspace.land(target.section as WorkspaceSection, target.selection);
    else pages.config.land(target.destination, target.section as ConfigSection, target.selection);
  };
  const landing = (target: RouteTarget): FocusOwner => {
    land(target);
    dismissOverlay();
    return "browser";
  };

  return {
    snapshot,
    canReturn: () => {
      const current = snapshot();
      return !!(current.relationshipReturn || current.contributionReturn || current.history.length);
    },
    destinationSelect(destination: Destination, focus?: FocusOwner) {
      const prior = snapshot();
      dismissOverlay();
      commit(
        {
          destination,
          history:
            prior.destination === destination
              ? prior.history
              : [...prior.history, prior.destination],
        },
        focus ?? "browser",
      );
    },
    destinationLanding(
      destination: Destination,
      target: Pick<RouteTarget, "section" | "selection">,
      focus?: FocusOwner,
    ) {
      if (!validTarget({ destination, ...target })) return;
      const prior = snapshot();
      land({ destination, ...target });
      dismissOverlay();
      commit(
        {
          destination,
          history:
            prior.destination === destination
              ? prior.history
              : [...prior.history, prior.destination],
        },
        focus ?? "browser",
      );
    },
    source(target: RouteTarget) {
      if (!validTarget(target)) return;
      const prior = snapshot();
      commit(
        {
          destination: target.destination,
          history:
            prior.destination === target.destination
              ? prior.history
              : [...prior.history, prior.destination],
          handoff: target.handoff,
        },
        landing(target),
      );
    },
    relationship(target: RelationshipTarget) {
      const activeReader = reader();
      const prior = snapshot();
      const address = activeReader?.address;
      if (
        !validTarget(target) ||
        prior.destination !== "workspace" ||
        pages.workspace.section() !== "skills" ||
        !address ||
        pages.workspace.selectedSkill() !== skillAddress(address) ||
        activeReader.tab !== "details"
      )
        return;
      commit(
        {
          destination: target.destination,
          history: prior.history,
          handoff: target.handoff,
          relationshipReturn: {
            destination: "workspace",
            section: "skills",
            selection: skillAddress(address),
            focus: target.returnFocus,
            address,
            tab: "details",
          },
        },
        landing(target),
      );
    },
    contribution(
      target: RouteTarget,
      returnTarget: {
        readonly destination: Destination;
        readonly section: Section;
        readonly selection?: string;
      },
    ) {
      if (!validTarget(target) || !validTarget(returnTarget)) return;
      const prior = snapshot();
      commit(
        {
          destination: target.destination,
          history: [...prior.history, returnTarget.destination],
          handoff: target.handoff,
          contributionReturn: returnTarget,
        },
        landing(target),
      );
    },
    back() {
      const prior = snapshot();
      if (prior.relationshipReturn) {
        const target = prior.relationshipReturn;
        land({
          destination: target.destination,
          section: target.section,
          selection: target.selection,
        });
        dismissOverlay();
        commit(
          { destination: target.destination, history: prior.history, handoff: undefined },
          target.focus,
        );
        selectReader(target.address, "details");
        return;
      }
      if (prior.contributionReturn) {
        const target = prior.contributionReturn;
        land(target);
        dismissOverlay();
        commit(
          {
            destination: target.destination,
            history: prior.history.slice(0, -1),
            handoff: undefined,
          },
          "browser",
        );
        return;
      }
      const destination = prior.history.at(-1);
      if (!destination) return;
      dismissOverlay();
      commit({ destination, history: prior.history.slice(0, -1), handoff: undefined }, "browser");
    },
  };
}
