# Bounded Docker runner

Run a command in the repository with fixed Docker limits (1 CPU, 2 GiB memory,
0 additional swap, 128 PIDs), no network, and no credential or Docker-socket mounts:

```sh
scripts/resource-run.sh bun test packages/skill-core/test/unit
scripts/resource-run.sh --timeout 300 bun scripts/build.ts cli
scripts/resource-run.sh --check
```

The timeout defaults to 120 seconds and can be set from 1 to 300. The runner
requires the local `node:22.23.2-bookworm` image and host Docker; it never pulls
an image or falls back to host execution. It binds the checkout read-write for
expected build outputs and the host Bun executable read-only. Jobs are
serialized with `/tmp/opencode/skill-cli-resource-run.lock`. On timeout,
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
