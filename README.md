# skill-cli

Manage installed Agent Skills, Sources and Collections through a command line or an independent terminal workbench.

## Programs

- **`skill-cli`** provides human-management commands and the installed-only Agent protocol.
- **`skill-tui`** provides the interactive workbench. It is installed separately and uses the same configuration and transaction storage as the CLI.

Put the binaries for your platform on `PATH`, or keep the matching release-named binaries in the same directory. For example, on Linux x64:

```text
skill-cli-linux-x64
skill-tui-linux-x64
```

They may also be renamed to `skill-cli` and `skill-tui` (`.exe` on Windows). CLI searches for an installed TUI next to its compiled executable before searching `PATH`. It never downloads or installs a missing TUI automatically.

```sh
skill-cli --help
skill-cli agent --help
skill-cli tui
skill-tui --project /path/to/project
```

Without a command, `skill-cli` starts the installed TUI when both input and output are terminals; otherwise it prints CLI help. Explicit TUI launch requires a terminal. `--project` selects the same project context for either program.

The two programs call the same Core implementation directly in their own processes. They do not communicate through a daemon or business RPC. Install matching release versions; no cross-version state compatibility is promised by the package split.

## Workspace

| Package                     | Responsibility                                                                   |
| --------------------------- | -------------------------------------------------------------------------------- |
| `packages/skill-core`       | Shared business capabilities, configuration, content, providers and transactions |
| `packages/skill-cli`        | Argument parsing, human/Agent output and installed-TUI process launch            |
| `packages/skill-tui`        | Solid/OpenTUI presentation and terminal lifecycle                                |
| `packages/opencode-adapter` | Existing OpenCode process-and-prompt integration                                 |

Core exposes `@skill-cli/core` as its public workspace entry. Frontends do not import its storage or provider internals. Workspace packages are private; this repository currently builds native release artifacts rather than publishing npm packages.

## Development

Use Bun **1.4.3**, with the dependency versions pinned in `bun.lock`. The Bun
types and CI setup are aligned to that version. Compiled CLI/TUI executables
embed their build runtime; running them does not require upgrading the host's
Bun installation. Explicit source proxy use requires embedded/source Bun 1.4.3
or newer. This toolchain pin does not by itself establish native artifact
compatibility; packaged verification remains a separate gate.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run schema:check
bun run build:cli
bun run build:tui
bun run pack:plugin
```

`build:native` is the convenience build for both native executables. CLI builds do not load the UI build plugin. Core and CLI do not promise Node compatibility: Core currently uses Bun APIs.

```sh
bun run test:unit
bun run test:providers
bun run test:integration
bun run test:cli
bun run test:tui
bun run dev:tui
```

UI preloads are scoped to the TUI commands, not the root Bun configuration. Run a selected TUI test through the bounded Docker runner:

```sh
scripts/resource-run.sh bun test --preload @opentui/solid/preload \
  --preload ./packages/skill-tui/test/test-renderer-preload.ts \
  packages/skill-tui/test/live-filter-popup.test.tsx --max-concurrency=1 --isolate
```

Run resource-heavy tests and native builds serially through `scripts/resource-run.sh`.
See [AGENTS.md](AGENTS.md) for repository working rules,
[CONTEXT.md](CONTEXT.md) for the domain model, [TECH.md](TECH.md) for technical
architecture and safety, and [DESIGN.md](DESIGN.md) for TUI component and interaction
standards. Design targets are not claims about the currently deployed UI.

## Agent output contract

Root browse supplies the usage instructions needed for system-prompt injection;
subsequent commands disclose the requested metadata or content:

| Command                                            | Default result                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent browse [collection-id]`                     | System-prompt-ready XML containing root Collection discovery instructions, or the immediate contents of the requested Collection without the repeated tutorial. |
| `agent search <query>`                             | At most 10 metadata results; `truncated: true` only when more matches exist. `--in` searches one Collection; default search does not traverse References.       |
| `agent load <selector>`                            | Complete, unwrapped `SKILL.md` text.                                                                                                                            |
| `agent read <selector> <path>`                     | Unwrapped UTF-8 resource text.                                                                                                                                  |
| `agent download <selector> <path> --output <path>` | JSON containing the absolute output path only. `--force` permits replacement of a regular file.                                                                 |
| `agent run <selector> -- <command> [args...]`      | Child stdout/stderr and exit status; no result JSON suffix.                                                                                                     |

Use `skill-cli --project <path> agent ...` to select project context. `--help` and
`-h` explain each subcommand; flags after the `run` delimiter belong to the child.

Run uses a temporary copy of the Skill Root, removed after exit. Write persistent
outputs to absolute paths. It is **not a sandbox**: the command can access the
host and network. Other Agent content operations use locally installed material
without provider acquisition. When Core reports the catalog unavailable, browse
returns fallback guidance on stdout with exit status 0. Command errors use stderr
and a nonzero status; the adapter reports subprocess failures and continues without
injecting a catalog.

Root browse output includes the discovery/loading tutorial and Collection metadata;
Collection browse output contains only that Collection's immediate contents. The
OpenCode adapter passes browse output through unchanged for chat and compaction,
without duplicating an identical prompt already present in the supplied output list.

Browse relevant branches, load matching Skills, and read resources according to the
current task and the Skill's conditions. Reuse applicable results and full instructions
still in context; reload needed content if missing after compaction or no longer current.
References can revisit a Collection, so another incoming reference alone does not
require another browse. An empty Collection reports only its own available contents.

Give exposed Collections descriptions that explain when to enter them. References
defer another Collection's members until it is browsed; Links merge members into the
current Collection. Keep these routing descriptions distinct from Skill instructions.

Local Skill content is read live, while discovery metadata reflects the last install
or explicit update. After editing a Local Skill, check for updates and apply the changed
Skill to synchronize its catalog description; checking alone does not update metadata.

## Source network

Set an optional proxy in the **user** Config at
`~/.config/skill-cli/config.jsonc` (or `$XDG_CONFIG_HOME/skill-cli/config.jsonc`
when `XDG_CONFIG_HOME` is set):

```jsonc
{
  "network": {
    "proxy": "http://127.0.0.1:7890",
  },
}
```

Omitting it preserves inherited environment and Git settings. An explicit HTTP
or HTTPS proxy overrides inherited proxy and bypass settings for Source HTTP(S)
acquisition, including Git, GitHub API, raw downloads and eligible provider
fallback. TLS verification remains enabled. This setting is not accepted in
project, local or reusable Configs; it does not change Source identity or proxy
SSH traffic.

Remote checks share a 30-second preparation budget; content acquisition shares
120 seconds across ref resolution, requests and eligible fallback. Cancellation
waits for owned acquisition work to settle. The network budget ends before
publication and never interrupts an atomic transaction. Agent operations on
installed content remain offline.

## TUI workspace

The Skills page starts in **Agent access** with folded Collection roots. Enter or click a
disclosure button to expand; selecting a Skill reads its installed SKILL.md
immediately. Enter moves into the Reader and Escape returns to the same browser.
Tab moves between regions; arrows stay inside the Tree.

**All Skills** includes the full installed inventory. Its Collection tree and
Filter share one condition, including Reference descendants. On compact windows,
use **Collections** to reveal the same hierarchy and **Back to Skills** to return.
Page navigation and the **Scope** selector live at the top; management commands
remain available through Details or Ctrl+P Actions.

## TUI updates

The TUI checks installed Sources in the background on startup. A successful Source
check is reused for up to eight hours across restarts when its binding and installed
comparison baseline still match. Checks only read sources; they never automatically
install, update, or remove Skills. **Check updates** forces a new check for the current
scope, while sharing an already-running check for the same Source.

Remote update checks compare already-installed Skill Roots using their Git tree
identities; new candidates require separate discovery. The public check result
retains an empty `added` array for compatibility. Applying an update obtains and
validates only the selected complete Roots at the exact reviewed commit, even if
the tracked ref subsequently moves. A changed tree is upstream evidence, not a
guarantee that the complete target content will pass installation validation.

Observation caching belongs to the TUI, not Core or the CLI. The cache retains
its v1 format, eight-hour successful lifetime and sixteen-hour stale retention.
Core's opaque comparison baseline invalidates observations from the older
discovery semantics without a cache-format migration. Both TUI review paths pass
the captured baseline to Core when supplied; callers that omit it still receive
Core's invocation-baseline guard. A timeout is a failed check, not cancellation,
and does not renew the previous success timestamp.

In Updates, Enter opens a Source's installed Skills. Space selects individual eligible
Skills in that Source; the update action submits only those selected addresses. Opening
a Source from a Collection's Updates does not widen the original Collection draft.
Back restores the originating scope and browsing state. Searching or filtering does
not change selected update targets; hidden selections are indicated before submission.

Expired results and failed refreshes are not treated as current update authorization.
Installation or Source-binding changes invalidate the comparison baseline. Stop is
cooperative and does not roll back updates that already committed.

The Agent protocol uses XML for browse and raw text for `load` and `read`; `run`
passes through child stdout/stderr and exit status. Protocol migration applies to
`load/read/run` only; do not parse their output as a JSON envelope.

## Packaged verification

The default packaged smoke verifies CLI-only operation, missing/installed TUI
handoff, isolated fixture management and Agent commands, direct Reader/Back and
focused Reader resizing at 144×40, 100×24, 80×24 and 43×13. It also exercises
compact Collection hierarchy/filter/return and Agent Tree direct reading without
changing the fixture Config. It does not replace human usability acceptance or
cover every historical UI journey. Extended journeys remain opt-in:

```sh
bun run smoke:packaged -- \
  --artifact /absolute/path/to/skill-cli-linux-x64 \
  --tui-artifact /absolute/path/to/skill-tui-linux-x64 \
  --output-root /absolute/path/to/fresh-fixture-root \
  --legacy-journeys
```

This repository still has legacy UI assertions that reflect older navigation and
a provider fixture affected by local Git blob-filtering behavior. A passing
bounded release smoke is not a claim that the full repository suite passes.
