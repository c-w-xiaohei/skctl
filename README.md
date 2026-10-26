<div align="center">

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo-readme-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/logo-readme-light.png">
    <img src="assets/brand/logo-readme-light.png" alt="skctl logo: three index cards with the middle card pulled to the right" width="128" height="128">
  </picture>

# skctl

**Manage your skills. Choose what agents discover.**

An Agent Skill manager with a CLI and terminal workbench.

[Get started](#get-started) · [Use cases](#use-cases) · [Configuration](#configuration-paths) · [Development](#development)

</div>

---

skctl means Skill Control. Maintain third-party Skills, tool documentation and
Skills you write yourself across projects. Install and update by Source, organize
discovery with Collections, and choose what agents can discover through global
and project configuration. The current agent integration is OpenCode.

## Use cases

### Maintain Skills by source

Related Skills often ship together in one Git repository. A Source records where
they come from and owns their updates. Check a Source for changes, review the
affected installed Skills and update them together or select a subset.

### Organize what agents discover

A Collection groups Skills behind a descriptive entry. For example, a Lark
Collection can introduce the tool without putting every operation's Skill
description into the initial catalog. An agent browses that Collection when
the task needs it, then loads the relevant instructions and resources.

Collections can follow a tool's suite or regroup Skills from several Sources.
Adding a Skill to another Collection reuses the same installation. Catalog
discovery and loading the full instructions are separate steps.

The **Collection as Skill** model adds optional custom instructions to
the member descriptions disclosed on entry, without repeating the Collection's
own description. Add an optional `instructions` string to a Collection in JSONC:

```jsonc
{
  "collections": {
    "frontend-perf-analysis": {
      "description": "Diagnose frontend performance and plan improvements.",
      "instructions": "Start by checking the available evidence.\nLoad only the member Skills needed for the current task.",
      // Keep your existing members, links and references here.
    },
  },
}
```

`skctl agent browse` shows the entry description. `skctl agent browse
frontend-perf-analysis` reveals its custom instructions and member descriptions;
`skctl agent load <selector>` still loads a selected Skill. See
[PRODUCT.md](PRODUCT.md#organize-discovery-around-tasks) for the authoring model.

In the TUI, Collection **Info** shows its description and custom instructions.
**Agent access** previews the selected Collection's instructions under
"Instructions · disclosed on entry"; selecting a Reference previews its target's
instructions while retaining the Reference's own entry description.

Configure these fields through the management CLI (writes default to project scope):

```sh
skctl collection set frontend-perf-analysis --description "Diagnose frontend performance"
skctl collection set frontend-perf-analysis --instructions-file ./collection-guide.md
skctl collection inspect frontend-perf-analysis --json
skctl collection set frontend-perf-analysis --clear-instructions
```

`--instructions <text>` accepts inline text. `--instructions-file` copies the file
contents into JSONC; it does not persist a file reference. Omitted fields and
existing members, links and references are preserved. Use `--clear-description`
or `--clear-instructions` to remove a field, and `--scope global|project|local`
to select its directly declared owner. Create a declaration with
`skctl collection create <id>` before configuring it.

### Reuse Skills across projects

Maintain one installed Skill and select its Collections in the projects that
need it. Global, project and local root selections combine additively. To expose
a Collection only in selected projects, declare it in those projects and leave
it out of global roots.

Projects using the same Installed Skill see the same current content, including
updates to that installation.

### Validate local edits in another project

Register the directory where you write a Skill as a local Source, then expose it
through a Collection in another project. Instructions and resources reflect local
edits. After changing a Skill's name or description, apply an explicit update to
refresh its discovery metadata.

### Share configuration through Git

Put reusable Sources and Collections in a Config repository for your own projects
or a team. Review changes in Git and select the required Collection roots in each
host Config.

Shared configuration describes Sources and Collections. Each machine maintains
its own installed Skills and versions.

<a id="programs"></a>

## Get started

- **`skctl`** manages Skills, Sources and Collections from the command line.
- **`sktui`** provides the interactive terminal workbench. It is installed separately
  and shares configuration and installed Skills with the CLI.

Install matching versions of the binaries for your platform. Put them on `PATH`,
or keep the release-named binaries in the same directory. For example, on Linux x64:

```text
skctl-linux-x64
sktui-linux-x64
```

Rename them to `skctl` and `sktui` to use the commands below. On Windows, keep
the `.exe` extension.

```sh
skctl --help
skctl tui
sktui --project /path/to/project
```

Running `skctl` without a command in an interactive terminal opens the installed
workbench. Use `--project /path/to/project` with either program to select a project.
The compiled binaries do not require Bun.

## Configuration paths

Both programs read the same configuration and installed state:

| Scope          | Path                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| Global Config  | `$XDG_CONFIG_HOME/skctl/config.jsonc`, defaulting to `~/.config/skctl/config.jsonc` |
| Project Config | `skctl.jsonc` in the project root                                                   |
| Local Config   | `skctl.local.jsonc` in the project root                                             |
| Linux state    | `$XDG_STATE_HOME/skctl`, defaulting to `~/.local/state/skctl`                       |
| macOS state    | `~/Library/Application Support/skctl`                                               |
| Windows state  | `%LOCALAPPDATA%\skctl`                                                              |

`SKCTL_STATE_DIR` overrides the state directory and requires an absolute path.
Configuration files can declare `"$schema": "https://skctl.dev/schema.json"`.

Installed state now uses format v4. Close older `skctl`/`sktui` processes before
using this version with the same state directory. Older formats remain readable
offline; the next successful management write upgrades state without moving or
rehashing installed content. Agent reads do not rewrite state. Downgrading after
a v4 write is not supported by older binaries.

Remote installations are private write-once snapshots, not tamper-detection
storage. Read commands check the selected path rather than hash every installed
file. Local resource edits are visible immediately; Local updates refresh Skill
name/description metadata. Remote previews compare installed and target Git
versions, not untracked edits inside the private snapshot directory.

### Proxy

Set an optional proxy in the **user** Config at
`~/.config/skctl/config.jsonc` (or `$XDG_CONFIG_HOME/skctl/config.jsonc`
when `XDG_CONFIG_HOME` is set):

```jsonc
{
  "network": {
    "proxy": "http://127.0.0.1:7890",
  },
}
```

This setting applies to HTTP(S) Source downloads and update checks, and belongs
only in the user Config. SSH uses its own configuration. If omitted, skctl uses
existing environment and Git proxy settings.

## Terminal workbench

The Skills page opens in **Agent access**, showing the Collections available to
your agent. Expand a Collection and select a Skill to read it. **All Skills**
shows your full installed inventory.

- Use Tab to move between regions and arrow keys to browse.
- Press Enter to move into the Reader and Escape to return.
- Use **Scope** to switch configuration contexts.
- Open **Details** for Skill management or press Ctrl+P for **Actions**.

### Updates

The workbench checks installed Sources for updates on startup. Use **Check updates**
to refresh the results. Checking does not install, update or remove Skills.

In **Updates**, open a Source, select the Skills you want with Space, then apply
the updates. Stopping an update leaves already applied updates in place.

## Development

Use Bun **1.4.3** and Docker. Install dependencies, check the source and build:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run schema:check
bun run build:native
bun run pack:plugin
```

Build outputs are written to `dist/`. Run `bun run dev:tui` to work on the TUI
from source. Builds and resource-heavy tests use the
[bounded Docker runner](scripts/resource-run.md).
