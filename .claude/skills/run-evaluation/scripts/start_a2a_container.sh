#!/usr/bin/env bash
# Starts the A2A server as a podman container for the evaluation pipeline.
# See docs/eval-a2a-container-runtime-spec.md for the design rationale
# (why --env-file is not used, why GITHUB_TOKEN is not forwarded, why
# --network=host is required).
#
# Must be run from the repository root (same assumption as run-evaluation
# SKILL.md Step 1). Bash tool invocations do not persist shell state across
# calls, so this script loads .env itself rather than relying on a prior
# step having sourced it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=.claude/skills/run-evaluation/scripts/common.sh
source "$SCRIPT_DIR/common.sh"

set -a
# shellcheck disable=SC1091  # .env is a gitignored runtime file, not present for linting
source .env
set +a

podman pull "$IMAGE"
echo "Image digest: $(podman image inspect --format '{{.Digest}}' "$IMAGE")"

# Forward CODE_REVIEW_*/OPENAI_API_KEY as value-less `-e KEY` so podman reads
# the already-parsed shell value (set by `source .env` above) instead of
# re-parsing .env itself -- `podman run --env-file` does not strip trailing
# inline comments the way bash `source`/python-dotenv do, which would corrupt
# values such as `OPENAI_API_KEY=sk-...  # comment`.
PODMAN_ENV_ARGS=()
for key in $(compgen -v | grep '^CODE_REVIEW_'); do
  PODMAN_ENV_ARGS+=(-e "$key")
done
if [ -n "${OPENAI_API_KEY:-}" ]; then
  PODMAN_ENV_ARGS+=(-e OPENAI_API_KEY)
fi
# GITHUB_TOKEN is intentionally not forwarded: the server reads it per-request
# from the Authorization header (run_agent_evaluation.py sends it), not from
# its own environment (src/code_review_agent/api/agents/common.py).

podman run -d --rm --replace --network=host \
  --name "$CONTAINER_NAME" \
  "${PODMAN_ENV_ARGS[@]}" \
  "$IMAGE"

SERVER_READY=0
for i in $(seq 1 20); do
  sleep 3
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "A2A server is ready"
    SERVER_READY=1
    break
  fi
  echo "Waiting for server... ($i/20)"
done

if [ "$SERVER_READY" -eq 0 ]; then
  echo "ERROR: A2A server did not start within 60s" >&2
  podman logs "$CONTAINER_NAME" || true
  podman stop "$CONTAINER_NAME" 2>/dev/null || true
  exit 1
fi
