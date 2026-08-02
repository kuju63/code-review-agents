#!/usr/bin/env bash
# Stops the A2A server container started by start_a2a_container.sh.
# --rm on `podman run` means a successful stop also removes the container;
# this is idempotent and safe to call even if the container is already gone.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=.claude/skills/run-evaluation/scripts/common.sh
source "$SCRIPT_DIR/common.sh"

podman stop "$CONTAINER_NAME" 2>/dev/null || true
echo "A2A server container stopped"
