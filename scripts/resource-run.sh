#!/usr/bin/env bash
set -Eeuo pipefail

readonly image="node:22.23.2-bookworm"
readonly owner_label="io.skill-cli.resource-run=skill-cli"
readonly lock_file="/tmp/opencode/skill-cli-resource-run.lock"
readonly workspace="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly uid="$(id -u)"
readonly gid="$(id -g)"
readonly container_name="skill-cli-resource-run-$(date +%s)-$$-${RANDOM}"
readonly container_label="io.skill-cli.resource-run.id=${container_name}"
docker_cli() {
  timeout --foreground --kill-after=1s 5s docker "$@"
}

timeout_seconds=120
if [[ "${1:-}" == "--check" ]]; then
  mode=check
  shift
elif [[ "${1:-}" == "--timeout" ]]; then
  [[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "--timeout requires seconds (1-300)" >&2; exit 2; }
  timeout_seconds="$2"
  (( timeout_seconds >= 1 && timeout_seconds <= 300 )) || { echo "--timeout must be 1-300 seconds" >&2; exit 2; }
  shift 2
  mode=run
else
  mode=run
fi

if [[ "$mode" == run && $# -eq 0 ]]; then
  echo "Usage: scripts/resource-run.sh [--timeout SECONDS] COMMAND [ARG ...]" >&2
  echo "       scripts/resource-run.sh --check" >&2
  exit 2
fi

if ! command -v docker >/dev/null || ! docker_cli info >/dev/null 2>&1; then
  echo "Docker daemon unavailable; refusing to run on the host." >&2
  exit 1
fi
if ! docker_cli image inspect "$image" >/dev/null 2>&1; then
  echo "Required local image $image is missing; refusing to pull or fall back." >&2
  exit 1
fi
if [[ "$mode" == check ]]; then
  runner_command=(sh -c '
    set -eu
    memory=$(cat /sys/fs/cgroup/memory.max)
    swap=$(cat /sys/fs/cgroup/memory.swap.max)
    cpu=$(cat /sys/fs/cgroup/cpu.max)
    pids=$(cat /sys/fs/cgroup/pids.max)
    [ "$memory" = 2147483648 ] || { echo "Unexpected memory.max=$memory" >&2; exit 1; }
    [ "$swap" = 0 ] || { echo "Unexpected memory.swap.max=$swap" >&2; exit 1; }
    [ "$cpu" = "100000 100000" ] || { echo "Unexpected cpu.max=$cpu" >&2; exit 1; }
    [ "$pids" = 128 ] || { echo "Unexpected pids.max=$pids" >&2; exit 1; }
    echo "Verified cgroup limits: memory.max=$memory memory.swap.max=$swap cpu.max=$cpu pids.max=$pids"
  ')
else
  bun_host="$(readlink -f "$(command -v bun)")"
  if [[ ! -x "$bun_host" ]]; then
    echo "Bun executable unavailable: $bun_host" >&2
    exit 1
  fi
  runner_command=("$@")
fi

container_mounts=()
container_workdir=/tmp
if [[ "$mode" == run ]]; then
  container_workdir="$workspace"
  container_mounts+=(
    --mount "type=bind,src=$workspace,dst=$workspace"
    --mount "type=bind,src=$bun_host,dst=/usr/local/bin/bun,readonly"
  )
fi

mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another resource-run job holds $lock_file; refusing concurrent execution." >&2
  exit 1
fi
existing="$(docker_cli ps -q --filter "label=$owner_label")"
if [[ -n "$existing" ]]; then
  echo "A managed resource-run container is already running ($existing); refusing to interfere." >&2
  exit 1
fi

cleanup() {
  local result=$?
  trap - EXIT INT TERM HUP
  local found running stopped
  if ! found="$(docker_cli ps -a -q --filter "name=^/${container_name}$")"; then
    echo "Could not determine whether owned container $container_name exists; cleanup is blocking." >&2
    exit 1
  fi
  if [[ -n "$found" ]]; then
    if ! running="$(docker_cli inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null)"; then
      echo "Could not inspect owned container $container_name; cleanup is blocking." >&2
      exit 1
    fi
    if [[ "$running" == true ]]; then
      if ! docker_cli stop --timeout 1 "$container_name" >/dev/null 2>&1; then
        echo "Could not stop owned container $container_name; cleanup is blocking." >&2
        exit 1
      fi
    fi
    if ! stopped="$(docker_cli inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null)"; then
      echo "Could not verify owned container $container_name stopped; cleanup is blocking." >&2
      exit 1
    fi
    if [[ "$stopped" != false ]]; then
      echo "Could not verify owned container $container_name stopped; cleanup is blocking." >&2
      exit 1
    fi
    docker_cli logs --tail 200 "$container_name" || \
      echo "Could not retrieve final logs for owned container $container_name." >&2
    if ! docker_cli rm "$container_name" >/dev/null 2>&1; then
      echo "Could not remove stopped owned container $container_name; cleanup is blocking." >&2
      exit 1
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

docker_cli create --pull=never --name "$container_name" \
  --label "$owner_label" --label "$container_label" \
  --cpus=1 --memory=2g --memory-swap=2g --pids-limit=128 --init \
  --security-opt no-new-privileges --cap-drop ALL --network none \
  --user "$uid:$gid" --workdir "$container_workdir" \
  "${container_mounts[@]}" \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777 \
  --env HOME=/tmp/home --env TMPDIR=/tmp \
  --entrypoint sh "$image" -c 'mkdir -p "$HOME"; exec "$@"' sh "${runner_command[@]}" >/dev/null
docker_cli start "$container_name" >/dev/null

set +e
timeout --foreground --signal=TERM --kill-after=1s "${timeout_seconds}s" \
  docker wait "$container_name"
wait_status=$?
set -e
if (( wait_status == 0 )); then
  if ! container_status="$(docker_cli inspect -f '{{.State.ExitCode}}' "$container_name")"; then
    echo "Could not inspect exit status for owned container $container_name." >&2
    result=1
  else
    result=$container_status
  fi
elif (( wait_status == 124 || wait_status == 137 )); then
  echo "Resource-run timed out after ${timeout_seconds}s; stopping owned container $container_name." >&2
  result=124
else
  echo "docker wait failed ($wait_status); stopping owned container $container_name." >&2
  result=$wait_status
fi

if (( wait_status == 0 )); then
  if oom="$(docker_cli inspect -f '{{.State.OOMKilled}}' "$container_name" 2>/dev/null)"; then
    if [[ "$oom" == true ]]; then
      echo "Owned container was OOM-killed (2 GiB memory limit)." >&2
      (( result != 0 )) || result=137
    fi
  else
    echo "Could not determine whether owned container $container_name was OOM-killed." >&2
    (( result != 0 )) || result=1
  fi
fi
exit "$result"
