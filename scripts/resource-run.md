# Bounded Docker runner

Run a command in the repository with fixed Docker limits of 1 CPU, 2 GiB memory,
0 additional swap and 128 PIDs. Jobs have no network, credentials or Docker-socket
mounts.

## Prepare the environment

Install project dependencies and fetch the required image before verification:

```sh
bun install --frozen-lockfile
docker pull node:22.23.2-bookworm
```

The runner mounts the host Bun executable, so use the repository's required Bun
version from `.bun-version`. The Node image provides the container environment.
The runner reports a missing image and exits; image preparation is an explicit
step outside the verification job.

## Run a job

```sh
scripts/resource-run.sh bun test packages/skill-core/test/unit
scripts/resource-run.sh --timeout 300 bun scripts/build.ts native
scripts/resource-run.sh --check
```

The timeout defaults to 120 seconds and can be set from 1 to 300. The runner
requires the local `node:22.23.2-bookworm` image and host Docker; it never pulls
an image or falls back to host execution. It binds the checkout read-write for
expected build outputs and the host Bun executable read-only. Jobs are
serialized with `/tmp/opencode/skctl-resource-run.lock`. On timeout,
cancellation, or exit, it stops, verifies stopped state, then removes only its
uniquely named/labelled container. If cleanup cannot be confirmed, it exits
nonzero and reports the container identity.

`--check` runs a tiny container to assert and print the enforced cgroup limits;
it does not run project code.

The package scripts `build:cli`, `build:tui`, `build:native`, `pack:plugin`,
`test:tui`, and `typecheck` use this runner. TUI tests default to concurrency 1.
Direct `scripts/build.ts` execution rejects host execution and Docker containers
without the required cgroup limits. These are project-level controls, not a
change to the Docker daemon or limits on unrelated user containers.

Scripts such as `lint`, `schema:check`, `test:cli` and `test:interfaces` do not
wrap every command in the runner. Invoke their underlying work through the runner
when required. Avoid wrapping a script that already starts its own runner, since
the inner job cannot acquire the same lock or use the Docker socket.

`native` builds the CLI, TUI and plugin artifacts. A source-mode OpenCode connection
or integration lifecycle test needs `bun run pack:plugin` first. The current
`typecheck` package list needs a separate integrations check:

```sh
scripts/resource-run.sh bun node_modules/typescript/bin/tsc -p packages/integrations/tsconfig.json --noEmit
```
