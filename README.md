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

Use Bun with the dependency versions pinned in `bun.lock`.

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

UI preloads are scoped to the TUI commands, not the root Bun configuration. To run a selected TUI test directly:

```sh
bun test --preload @opentui/solid/preload \
  --preload ./packages/skill-tui/test/test-renderer-preload.ts \
  packages/skill-tui/test/live-filter-popup.test.tsx --max-concurrency=1 --isolate
```

Run resource-heavy tests and native builds serially. Domain rules are documented in [CONTEXT.md](CONTEXT.md) and [DESIGN.md](DESIGN.md).

## Packaged verification

The default packaged smoke verifies CLI-only operation, missing/installed TUI
handoff, isolated fixture management and Agent commands, browser resizing, and
Reader/Back at a stable window size. It does not establish complete Inspector or
Reader resize restoration. Historical extended UI journeys remain opt-in:

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
