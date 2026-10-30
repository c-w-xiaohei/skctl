# Codex host verification

## Current support: 0.164.0 native, 0.118.0 guidance

The adapter now requires exact Codex **0.164.0** and the `hooks` feature.
Version **0.118.0** uses default guidance. Other versions, including prereleases,
block automatic selection until verified. Existing incompatible hooks remain
removable and require explicit migration.

The 0.164.0 native binary was staged from the official npm platform package after
checking its SHA-512 integrity metadata. The bounded Docker probe uses isolated
HOME, CODEX_HOME, project and skctl state. It reviews fixture hooks through the
same `hooks/list` and `config/batchWrite` protocol used by Codex `/hooks`.
Production skctl never writes trust records. No real installation was changed.

| Exercised contract          | Result                                                                            |
| --------------------------- | --------------------------------------------------------------------------------- |
| Global JSON and inline TOML | Reviewed hooks deliver the complete catalog                                       |
| Startup, resume, nested cwd | Correct current catalog and working directory                                     |
| Fork and compaction         | Fresh catalog with the correct lifecycle source                                   |
| Clear                       | `thread/start` with `sessionStartSource: clear` delivers fresh context            |
| SubagentStart               | A real child receives fresh context after a scripted Responses tool call          |
| Large catalog               | 90 Collections / 30,936 bytes delivered intact using `additionalContextLimit = 0` |
| Disconnect                  | A new session no longer receives the catalog                                      |
| Codex 0.118.0               | Real host loads default guidance and stops loading it after disconnect            |

The loopback Responses recorder verifies actual outgoing context. It supplies a
scripted `spawn_agent` response for the child case and otherwise fixed text.
Clear is exercised through the real host API, without interactive terminal
keystrokes. Default guidance delivery does not prove remote-model instruction
following or Skill selection.

Reproduce with rebuilt skctl and staged native executables:

```sh
scripts/resource-run.sh --timeout 180 bun verification/codex-composition.ts \
  tmp/codex-0.164.0/codex tmp/codex-0.164.0
scripts/resource-run.sh --timeout 120 bun verification/codex-composition.ts \
  tmp/codex-real-host-20261027/codex tmp/codex-real-host-20261027
```

Each run retains requests, hook stdin/cwd, host review responses, binary hashes
and lifecycle events in a unique `run-*` directory. Failed assertions return
nonzero. Current selection fixes the historical failures described below.

Trust checks also verify that unreviewed or changed definitions, disabled reviewed
hooks and untrusted projects do not execute.

## Review and regression record

Final rebuilt-binary evidence (2026-10-27):

- Native: `tmp/codex-0.164.0/run-nfi8OC/` — all exercised cases pass.
- Default: `tmp/codex-real-host-20261027/run-pWWoDU/` — guidance delivery and removal pass.
- Codex 0.164.0 SHA-256: `b93f6811d3f653f0fb83be4050d857fb9abbb111dfa2ce160563327daff7f306`.
- skctl SHA-256: `619819f24d4d579414e607bd8e341ad9e5075098b64e2fb8127843919a147e03`.

The final `native` build completed through the Docker runner. CLI integration help
and TUI help executed successfully from the rebuilt binaries.

Independent code review identified eight concrete issues in entry selection,
strict JSON parsing, fallback precedence, plugin metadata inspection, keyboard
navigation, lock cleanup, auxiliary reads and legacy plugin detection. Each was
reproduced before its correction. Targeted re-review found three edge-case
regressions; their tests and corrections close the review with no remaining
findings. Independent simplification review passed; three local readability
suggestions were applied without changing behavior.

The final CLI/Core/integrations/OpenCode-adapter regression run completed with
381 passes, two environment skips and no failures. All five package typechecks
passed. The integration renderer tests passed 22 assertions across three tests,
covering panel traversal, action arrows and complete App operations with Core
loading both available and failed.

The full TUI suite was attempted and did not pass; it reached its 180-second
limit with existing failures. Four representative panel-navigation failures were
reproduced unchanged in a `git archive HEAD` baseline with the same dependencies.
This work does not claim a passing full TUI suite. Real OpenCode V2 loading is
covered by the separate [V2 report](opencode-v2-composition.md).

## Historical 0.118.0 native-hook findings

Verified on 2026-10-27 using the locally installed native Linux x64 Codex binary
and the built skctl CLI. The basic JSON-hook path delivers the catalog, but the
initial adapter did **not** satisfy its full lifecycle contract on this version.
Inline TOML hooks and post-compaction refresh fail.

## What ran

The probe runs inside `scripts/resource-run.sh` with an isolated HOME,
CODEX_HOME, Git project and skctl state. No real installation, credentials or
user trust storage are mounted or changed. The wrapper named `skctl` records hook
stdin and cwd, then executes `dist/skctl-linux-x64` with the original arguments.

Codex is the real executable. A local Responses API recorder replaces only the
remote model service and returns a fixed response without requesting tools.
The probe compares the actual outgoing `developer` message with complete
`skctl agent browse` output. This verifies host execution and request assembly;
it does not measure a language model's interpretation or subsequent Skill choices.

Fork and compaction use the real Codex app-server protocol. The recorder returns
a fixed compaction summary, then checks the following request for a freshly
changed catalog marker. Codex's emitted hook events and subprocess stdin are
retained alongside each request.

## Results

| Case                               | Observed result                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Default feature state              | `codex_hooks` is `under development`, disabled by default                                                                      |
| Explicitly disabled hooks          | Entry written; inspection reports `HOOKS_DISABLED`; no hook invocation or injected catalog                                     |
| Global `hooks.json`, hooks enabled | Startup executes the real CLI; complete browse output appears as developer context                                             |
| Repeated connection                | Returns `unchanged`                                                                                                            |
| Resume after changing the catalog  | New `source: resume` invocation; the changed catalog reaches the request                                                       |
| Session in a project subdirectory  | Hook receives the subdirectory cwd and resolves the project catalog correctly                                                  |
| Project `hooks.json`               | Catalog reaches the request                                                                                                    |
| Disconnect                         | New session has no hook invocation or catalog injection                                                                        |
| Inline `config.toml` hooks         | Installer returns `applied`; Codex makes a request without running the hook or receiving the catalog                           |
| Fork                               | New catalog reaches the fork; hook source is `startup`, not `fork`                                                             |
| Compaction                         | Operation completes; no fresh hook invocation; the next request has no catalog from the hook                                   |
| Large catalog                      | 90 Collections, 30,936 UTF-8 bytes after trimming, delivered intact as developer context                                       |
| Project marked untrusted           | This version's `exec` still executes the project hook; its hook payload reports `bypassPermissions` even without a bypass flag |

The untrusted-project result is specific to the tested noninteractive command.
It does not establish the behavior of the interactive `/hooks` review flow in
newer releases. No hook-trust bypass flag was passed.

The installed configuration includes `SubagentStart`, but this version's hook
event enum does not implement it. No real subagent or interactive clear event
was exercised. The full installed JSON and a SessionStart-only diagnostic control
both inject successfully at startup.

## Compatibility findings

The initial installer treated either `hooks` or `codex_hooks` in the feature
list as sufficient for the full adapter. Codex 0.118.0 disproves that assumption.
Feature presence does not establish support for inline configuration, compaction
refresh, subagent events or the newer trust workflow.

The recommended correction is to select the adapter using a verified host
capability/version contract. Old experimental hook support needs its own explicit
compatibility decision. The tested version cannot be labelled fully supported by
the native adapter. Production selection now routes this version to guidance.

An additional installer issue appeared during fixture transitions. Disconnect
leaves empty event arrays in `hooks.json`; a later connection with inline hooks
reports `MULTIPLE_HOOK_SOURCES`. The final inline test removes that isolated empty
JSON fixture first, verifies `connect` returned `applied`, and then observes the
host ignoring the inline configuration. These are separate failures.

## Historical evidence

Copy the intended native Codex binary into a directory under the checkout so the
Docker runner can read it. A shell wrapper pointing into an unmounted package
manager directory is insufficient. Do this preparation before verification.
Build skctl through the runner if its artifact is missing or stale.

The historical run `tmp/codex-real-host-20261027/run-EsLthH` records the original
failure. The current probe instead checks default guidance for this version.

Evidence retained locally under `tmp/codex-real-host-20261027/` includes:

- `summary.json`, binary hashes and the effective feature list.
- `requests.json`, outgoing request bodies sent to the local recorder.
- `hook-stdin.log` and `hook-cwd.log`, actual subprocess inputs.
- `installed-hooks.json` and `installed-inline.toml`, installed definitions.
- `app-events.json` and `app-lifecycle-summary.json`, fork/compaction evidence.
- Per-command JSON with argv, exit status, timeout, stdout and stderr.

Verified binary identities:

| Binary          | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| Codex 0.118.0   | `64760d0b24804c4d258abc3427811305254f2199a3ddae5de7f443851a43f0bb` |
| skctl Linux x64 | `42680ccad86946117a93e78368a06d8c3ef6301514c1277ccb7a6029b6112792` |

The same-version source corroborates the observed limits:

- [Hook configuration events](https://github.com/openai/codex/blob/rust-v0.118.0/codex-rs/hooks/src/engine/config.rs)
- [SessionStart implementation](https://github.com/openai/codex/blob/rust-v0.118.0/codex-rs/hooks/src/events/session_start.rs)
- [Additional context handling](https://github.com/openai/codex/blob/rust-v0.118.0/codex-rs/hooks/src/events/common.rs)
