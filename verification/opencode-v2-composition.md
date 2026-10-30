# OpenCode V2 composition verification

The real OpenCode 2.0.32 host loads the adapter produced by this checkout and
delivers the current `skctl agent browse` output to outgoing model requests.
Testing uses Linux x64, isolated HOME/config/state/project directories, and a
loopback OpenAI-compatible SSE recorder. No remote model or user credentials are
used. This verifies host execution and context delivery, not model Skill selection.

## Reproduce

Stage the native OpenCode 2.0.32 binary as `tmp/opencode-v2-host/opencode` before
verification. The probe also accepts its path as its first argument. Then run:

```sh
scripts/resource-run.sh --timeout 300 bun scripts/build.ts native
scripts/resource-run.sh --timeout 120 bun verification/opencode-v2-composition.ts
```

All host processes run within the runner's 1 CPU, 2 GiB, no-extra-swap, 128-PID
limits. The probe creates its own temporary credentials and redacts them from
server logs. Executable fixtures live in the checkout mount because Docker's
temporary directory is mounted noexec. The packaged adapter is not instrumented.

## Verified behavior

| Case                          | Observable evidence                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Global and project connection | Native CLI receipts, host plugin status, model requests                                             |
| Idempotent connect            | Repeated connection returns `unchanged`                                                             |
| Startup and catalog refresh   | Exact fresh CLI output occurs in system context                                                     |
| Compaction                    | New catalog occurs in the compaction request and subsequent turn                                    |
| Session directory move        | Next request contains the catalog from the moved location                                           |
| CLI failure                   | Model request still completes, without the failed catalog                                           |
| Disconnect and reload         | Subsequent requests contain no catalog marker                                                       |
| In-flight cleanup             | Live child PID disappears within the existing 30-second timeout plus 5-second observation allowance |

OpenCode 2.0.32's Promise bridge defers plugin cleanup while an active hook runs.
Reload therefore does not promise immediate cancellation. The adapter retains its
abort cleanup and timeout escalation. `unload.json` records child start, reload,
observed exit and the lifetime limit; it does not infer the termination signal.

The first global run exposed two actual installation defects: the host reports
`opencode v2.0.32`, and local plugin paths require `./` or `../`. Both have
regression coverage in `packages/integrations/test/lifecycle.test.ts`.

## Evidence

Final uninstrumented expanded run: `tmp/opencode-v2-host/run-jfu5Ou/`.
`summary.json` records host, CLI, release adapter and installed project adapter
SHA256 values. `requests.json`, `plugins-loaded.json`, CLI receipts and
`unload.json` preserve the observations. Earlier `run-YV0GWG` is diagnostic-only
evidence with a modified copied plugin; it is not a release-artifact acceptance run.

The final run measured 31,174 ms against the 35,000 ms in-flight lifetime limit.
CLI SHA256: `619819f24d4d579414e607bd8e341ad9e5075098b64e2fb8127843919a147e03`.
Release and installed adapter SHA256:
`a9de4b67b0aa65b44ffbaa8eb4582bae8dcb2e6f9fa15275bdfba61f43ee4141`.

Complete App renderer tests are in `packages/sktui/test/integrations-app.test.tsx`.
They exercise keyboard navigation and selected-entry mutations through the shared
API when Core loads or fails; they do not write the user's real host configuration.
The pre-existing full TUI suite is not green; four representative panel failures
were reproduced in an unmodified HEAD snapshot.
