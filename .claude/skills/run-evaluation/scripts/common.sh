#!/usr/bin/env bash
# Shared constants for the A2A eval container lifecycle scripts.
# Sourced by start_a2a_container.sh / stop_a2a_container.sh -- not meant to
# be executed directly.

# shellcheck disable=SC2034  # consumed by scripts that source this file
CONTAINER_NAME="${CODE_REVIEW_EVAL_CONTAINER_NAME:-code-review-agent-eval}"
# shellcheck disable=SC2034  # consumed by scripts that source this file
IMAGE="${CODE_REVIEW_EVAL_IMAGE:-quay.io/kuju63/code-review-agent:latest}"
