#!/bin/bash

set -euo pipefail

# Python環境のセットアップ
uv venv
# shellcheck source=.venv/bin/activate
source .venv/bin/activate
uv sync --frozen

# Worktreeセットアップ後の設定のリンク
WORKTREE_ROOT=$(git rev-parse --show-toplevel)
PROJECT_ROOT=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)

# Claude Codeの設定をリンク
if [ -f "$PROJECT_ROOT/.claude/settings.local.json" ]; then
    mkdir -p "$WORKTREE_ROOT/.claude"
    ln -sf "$PROJECT_ROOT/.claude/settings.local.json" "$WORKTREE_ROOT/.claude/settings.local.json"
    echo "[INFO] Link claude code local setting file."
fi

if [ -f "$PROJECT_ROOT/.env" ]; then
    ln -sf "$PROJECT_ROOT/.env" "$WORKTREE_ROOT/.env"
    echo "[INFO] Link root .env"
else
    cp "$WORKTREE_ROOT/.env.example" "$WORKTREE_ROOT/.env"
    echo "[WARN] Create the .env file from the example .env file"
fi

# evaluation dataのリンク
if [ -d "$PROJECT_ROOT/evaluation/data" ]; then
    ln -sf "$PROJECT_ROOT/evaluation/data" "$WORKTREE_ROOT/evaluation/data"
    echo "[INFO] Link evaluation data"
fi
