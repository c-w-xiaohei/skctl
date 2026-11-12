<div align="center">

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo-readme-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/logo-readme-light.png">
    <img src="assets/brand/logo-readme-light.png" alt="skctl logo: three index cards with the middle card pulled to the right" width="128" height="128">
  </picture>

# skctl

An Agent Skill manager with a command-line tool and a terminal workbench.

English · [简体中文](README-zh.md)

</div>

## Contents

- [Introduction](#introduction)
- [Features](#features)
- [How it works](#how-it-works)
- [Install](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Usage](#usage)
- [Agent integration](#agent-integration)
- [Configuration](#configuration)
- [Development](#development)

## Introduction

Have you run into any of these?

- A project installs a marketing Skill set from GitHub so the agent can help run marketing; the set has more than a hundred member Skills. This time the task is adding a usage section to the README, and under the usual installation the dozen groups for positioning, SEO, email, paid ads and creators unfold in the catalog along with each member's description; one writing Skill is all the task needs.
- A project has three performance-analysis Skills installed, each doing a different job. Their descriptions alone do not say which one comes first or how they fit together, so the division of labor is explained again in every session, and again for the next person or project.
- Take `solid-js-best-practices`: it only matters in SolidJS projects. Install it globally and every session in a React project, a backend service or a CLI repository sees it; install it only where needed and two SolidJS projects keep a copy each, so when upstream changes the guidance the copies drift, and updating means visiting each project and remembering which ones installed it.
- When upstream changes a few Skills, say paid ads and email from the marketing source, `npx skills update` has no way to select a whole source. You name each member, or update everything and touch other sources too.
- `skills-lock.json` can restore the Skills a project installed from their sources and verify them by hash, but what comes back is still a flat list. The traditional model has no collection layer, so there is nowhere to record why the team chose these sets, which members belong together, or what to read first for a given task. A new colleague restores the installs and still has to ask.
- A release Skill you wrote yourself can only be tried in another project by copying the files over. Project A puts build output in `dist/`, so the instructions read `dist/`. Project B builds into `build/`, and the agent following the same instructions finds nothing. Every fix has to be synced in two places.

These problems look different, but they share one cause. Where a Skill is stored, how it is updated, and what the agent can see could be decided separately, yet the usual installation ties them together. skctl separates the three.

## Features

- **Collection as Skill**: Use Collections as the organizing unit for existing Skills. A Collection turns a group of Skills into one catalog entry; the agent sees member descriptions after entering, and reads a member's instructions only when it loads that member. That adds another layer of progressive disclosure on top of the Skills, so the context window no longer holds a hundred member Skills at once. The Collection's own instructions can tell similar Skills apart and record how several Skills work together, so the next task of the same kind follows the same path.
- **One update, per-project selection**: A Skill is installed once on the machine, with a Source recording its repository. Update it once and every project that selected it reads the new version next time; which project can use it is decided by the Collections that project selects, so projects that select none never see it and projects that do read the same installation. Remote sources install at an exact commit, and candidates can be listed and reviewed before anything is installed.
- **Updates by Source**: No need to recall member names; start from the Source. The check lists what changed across the set; you pick the members to apply, and the check itself leaves installed content untouched. Newly added Skills in the repository are not installed along the way.
- **Team sharing**: Sources, Collections, membership, disclosure layers and instructions all live in JSONC; the whole configuration is declarative. The shared part goes into a `config.jsonc` in the repository, and the entries a project enables go into its `skctl.jsonc`. A new colleague installs what is missing from those two files and inherits the team's setup without asking around.
- **Local development**: When you are writing a Skill, register its directory as a local Source and you can try it from another project directly. Edits to instructions and resources take effect immediately; only the name and description need one explicit update.

## How it works

skctl's integration writes a short entry into the coding agent's system prompt: when you need to find a Skill, call `skctl agent browse` first. The command returns the currently disclosed Skill catalog and a short usage guide, and the agent takes every later address from that catalog.

What appears in the catalog is decided by `use` declarations: enable a few Collections and the catalog lists those entries, each with a short description. That is the first disclosure layer. If a task matches, the agent calls `skctl agent browse <collection>` to see the Collection's custom instructions and immediate member descriptions. Once it settles on a member, `skctl agent load <collection>:<member>` brings in the full instructions. Scripts and reference files are listed with `agent ls` and read with `agent read` only when needed. Each layer opens only when the one above it is not enough, and Skill instructions stay on disk until the agent asks for them.

For example, a project enables two Collections, `frontend` and `docs`, and you ask the agent to restyle a button. The catalog shows the `frontend` entry; the agent browses in, finds a `css-conventions` member, loads the full instructions, and starts work. `docs` has nothing to do with the task, so the agent never enters it, and none of its members or instructions enter the context.

`skctl integration connect` picks the way in for the host: lifecycle hooks for Codex, a plugin for OpenCode, and a fixed instruction file for an unknown host, so the agent can look up the catalog itself. The injected content is only the entry and the usage guide; Skill instructions stay on disk. Where Skills are installed and which Collections a project can use stay under skctl's management, so an update changes one installation and the agent reads the new version next time.

## Install

skctl ships as two programs that read the same configuration and installed state:

| Program | Role                                                              |
| ------- | ----------------------------------------------------------------- |
| `skctl` | Management CLI; opens the workbench when run without a subcommand |
| `sktui` | Standalone terminal workbench                                     |

Both are native binaries with no extra runtime. Release artifacts are named per platform, for example `skctl-linux-x64`, `sktui-linux-x64`, `skctl-darwin-arm64` and `skctl-windows-x64.exe`, and can be downloaded from the repository's Releases page. Put `skctl` and `sktui` on `PATH`, or keep them in one directory under the release names; on Windows keep the `.exe` extension. To build from source, see [Development](#development).

```sh
skctl --help
skctl tui
sktui --project /path/to/project
```

Both programs accept `--project` to set the project boundary. Running `skctl` directly in an interactive terminal opens the workbench.

## Quick start

### 1. Register a source and install

Remote sources install at an exact commit; local sources read the original directory.

```sh
# Register a Git repository
skctl source register github team https://github.com/acme/skills --ref main --scope global

# List candidate Skill Roots at that revision (nothing is installed yet)
skctl source discover team --json

# Install one reviewed root at its exact commit
skctl install team skills/review --revision <40-hex-commit>
```

To register a local directory:

```sh
skctl source register local mine /path/to/skills --scope global
skctl install mine skills/review
```

### 2. Create and enable a Collection

```sh
skctl collection create task-review
skctl collection member add task-review review team skills/review
skctl use add task-review -g
```

`use add` puts the Collection in the agent catalog.

### 3. Connect an agent host

Configure once per host and scope:

```sh
skctl integration connect codex --scope global
skctl integration connect opencode --scope project --project /path/to/project
```

### 4. Agent reads

The agent reads layer by layer with these commands:

```sh
skctl agent browse                  # catalog roots and the description of each entry
skctl agent browse task-review      # custom instructions and member descriptions
skctl agent load task-review:review # the selected Skill's full instructions
skctl agent ls task-review:review   # supporting resources, without loading them
```

## Concepts

| Term                 | Meaning                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Source**           | A repository or directory that provides Skills. It owns acquisition and updates.                              |
| **Installed Skill**  | One Skill actually installed on this machine; remote Skills are pinned to an exact revision.                  |
| **Collection**       | A named group of installed Skills, with a description of when the agent should enter.                         |
| **Use**              | A declaration that puts a Collection in the agent catalog, at global, project or local scope.                 |
| **Reference / Link** | Relationships between Collections: a Reference points at another Collection's entry, a Link includes it live. |

A Skill is installed once and can belong to any number of Collections. Membership, discoverability and context loading are independent, so different projects can enable different Collections while using the same installation.

## Usage

### Configure a Collection

A Collection is written much like a Skill: the description says when to enter; once inside, the agent gets member descriptions and the instructions you wrote, without seeing the Collection's own description again. Instructions are optional and live in JSONC:

```jsonc
{
  "collections": {
    "frontend-perf-analysis": {
      "description": "Diagnose frontend performance and plan improvements.",
      "instructions": "Start by checking the available evidence.\nLoad only the member Skills the current task needs.",
      // Keep the members, Links and References here
    },
  },
}
```

It can also be set from the CLI, writing to project scope by default:

```sh
skctl collection set frontend-perf-analysis --description "Diagnose frontend performance"
skctl collection set frontend-perf-analysis --instructions-file ./collection-guide.md
skctl collection inspect frontend-perf-analysis --json
```

- `--instructions` takes inline text; `--instructions-file` copies the file content into JSONC and keeps no reference to the file.
- Fields, members, Links and References not mentioned in the command are preserved as they are.
- `--clear-description` and `--clear-instructions` remove the corresponding field.
- `--scope global|project|local` sets the owner.

### Updates

**Check updates** only refreshes the check result and does not modify installed content. To apply updates, open the corresponding Source on the **Updates** page of the workbench, select the Skills to update with Space, then apply. Stopping mid-update keeps the parts already applied. The workbench checks installed Sources for updates on startup.

### Migrating to another Source

Moving an installed Skill under another Source requires a preview and review before applying:

```sh
skctl rebind preview old-source skills/review new-source --json > rebind-review.json
skctl rebind apply rebind-review.json
```

If the Source-relative path at the destination differs, add `--path` to `preview`. The rules are:

- Core must prove that the old and new addresses identify the same Skill.
- The preview lists affected direct memberships.
- Apply repairs writable addresses together with ownership and rejects stale evidence.
- The operation covers the captured workspace only, not unknown projects that also reference the old address.

### Terminal workbench

The workbench contains six pages: **Skills, Collections, Sources, Updates, Agent, Settings**.

| Action                           | Key              |
| -------------------------------- | ---------------- |
| Move between regions             | Tab              |
| Browse                           | Arrow keys       |
| Enter / return                   | Enter / Escape   |
| Open the current page's commands | Ctrl+P (Actions) |

What each page contains:

- **Skills**: the installed inventory. When nothing is installed, the first step is **Add Source**.
- **Collections**: each Collection has **Members**, **Description & instructions** and **Settings**.
- **Sources**: each Source has **Installed** and **Source settings**.
- **Updates**: check and apply updates.
- **Agent**: the catalog and host connections are shown separately; connect, inspect or disconnect Codex and OpenCode here.
- **Settings**: choose the Global, Project or Local configuration scope.

## Agent integration

`skctl integration connect` picks the matching adapter for the host:

- **Codex**: uses native lifecycle hooks that call `skctl agent browse`.
- **OpenCode V2**: uses a plugin bundled with the binaries.
- **Other cases**: when no adapter matches, `default` writes stable guidance to an instruction file and does not switch to another mechanism automatically.

Automatic setup stops when compatibility is unknown or installation fails. Repeating `connect` maintains the existing entry. Running `disconnect` with the same host and scope removes it. Entries keep their original mechanism after an upgrade. Connecting a host only provides the path. What the agent can see is decided by `use` declarations.

<details>
<summary>Host compatibility and retired settings</summary>

Codex 0.164.0 uses the native adapter, 0.118.0 uses instruction guidance, and other versions need compatibility verification before automatic setup. Codex requires hook review in `/hooks`; OpenCode needs its service or location reloaded after configuration changes. Real-host tests cover trusted JSON and inline hooks, startup, resume, fork, compaction, subagent context and large-catalog delivery for Codex, and global and project loading, catalog refresh, compaction, moved session cwd, CLI failure and removal for OpenCode 2.0.32.

`agents.opencode: "managed"` is deprecated and ignored. `skctl managed set` and `unset` return `MANAGED_COMMAND_RETIRED` and write no configuration. After an upgrade, existing plugins can start receiving a catalog even if the old managed gate was off. For managed entry paths, custom host executables, removal and migration, see `skctl integration --help`.

</details>

## Configuration

`skctl` and `sktui` read the same configuration and installed state:

| Scope          | Path                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| Global Config  | `$XDG_CONFIG_HOME/skctl/config.jsonc`, defaulting to `~/.config/skctl/config.jsonc` |
| Project Config | `skctl.jsonc` in the project root                                                   |
| Local Config   | `skctl.local.jsonc` in the project root                                             |
| Linux state    | `$XDG_STATE_HOME/skctl`, defaulting to `~/.local/state/skctl`                       |
| macOS state    | `~/Library/Application Support/skctl`                                               |
| Windows state  | `%LOCALAPPDATA%\skctl`                                                              |

- `SKCTL_STATE_DIR` can override the state directory, and its value must be an absolute path.
- Configuration files can declare `"$schema": "https://skctl.dev/schema.json"`.
- Agent entry files belong to Codex or OpenCode and are managed by `skctl integration`. They have only `global` and `project` scopes; `local` applies only to skctl's own content configuration.

<details>
<summary>Proxy</summary>

Set it in the user Config at `~/.config/skctl/config.jsonc` (or the corresponding path when `$XDG_CONFIG_HOME` is set):

```jsonc
{
  "network": {
    "proxy": "http://127.0.0.1:7890",
  },
}
```

This setting applies to HTTP(S) Source downloads and update checks, and belongs only in the user Config. SSH uses its own configuration. When unset, the existing environment variables and Git proxy settings are used.

</details>

<details>
<summary>Installed state and remote snapshots</summary>

Installed state uses format v4. Before upgrading, close all older `skctl` and `sktui` processes, then let the new version use the same state directory. Older formats remain readable offline and are upgraded on the next successful management write; that process neither moves installed content nor rehashes it. Agent reads do not write state, but once the state is v4, older binaries cannot use that directory. Remote installations are private, write-once snapshots and do not provide tamper detection: read commands check the selected path and do not hash every installed file. Local resource edits are visible immediately, and Local updates refresh only name and description metadata. Remote previews compare the installed version with the target Git version and exclude untracked edits inside the private snapshot directory.

</details>

## Development

Development needs Bun **1.4.3** and Docker. Prepare dependencies and the runner image first:

```sh
bun install --frozen-lockfile
docker pull node:22.23.2-bookworm
```

Verification and builds run through the bounded [Docker runner](scripts/resource-run.md):

```sh
bun run typecheck
scripts/resource-run.sh bun node_modules/typescript/bin/tsc -p packages/integrations/tsconfig.json --noEmit
scripts/resource-run.sh bun run lint
scripts/resource-run.sh bun run schema:check
scripts/resource-run.sh --timeout 300 bun scripts/build.ts native
```

Build commands:

- `native`: builds the CLI and TUI for the current platform and writes `opencode-adapter.js`, `opencode-adapter.tgz`, `SHA256SUMS` and `release-metadata.json` to `dist/`.
- `build:cli`, `build:tui`: build a single binary plus the plugin.
- `pack:plugin`: builds only the plugin.

Individual test suites:

```sh
bun run pack:plugin
scripts/resource-run.sh bun test packages/integrations/test packages/opencode-adapter/test
scripts/resource-run.sh bun test packages/skctl/test
bun run test:tui
```

For interactive development from source: `bun run dev:tui`.
