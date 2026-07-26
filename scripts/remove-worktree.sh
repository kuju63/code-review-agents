#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [--force] <worktree-path>\n' "$0" >&2
  exit 2
}

force=false
if [[ "${1:-}" == "--force" ]]; then
  force=true
  shift
fi
[[ $# -eq 1 ]] || usage

common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
project_root=$(dirname "$common_dir")
worktrees_root=$(realpath "$project_root/.claude/worktrees")
target=$(realpath "$1")

[[ "$target" == "$worktrees_root/"* ]] || {
  printf 'Refusing to remove a worktree outside %s: %s\n' "$worktrees_root" "$target" >&2
  exit 1
}

registered=false
while IFS= read -r line; do
  [[ "$line" == "worktree $target" ]] && registered=true
done < <(git worktree list --porcelain)
[[ "$registered" == true ]] || {
  printf 'Not a registered Git worktree: %s\n' "$target" >&2
  exit 1
}

serena_config="${SERENA_CONFIG_FILE:-$HOME/.serena/serena_config.yml}"
backup=
removed=false
if [[ -f "$serena_config" ]]; then
  backup=$(mktemp)
  cp -p "$serena_config" "$backup"
  result=$(python3 - "$serena_config" "$target" <<'PY'
import json
import os
from pathlib import Path
import sys
import tempfile

config_path = Path(sys.argv[1])
target = os.path.realpath(sys.argv[2])
text = config_path.read_text()
lines = text.splitlines(keepends=True)
start = next((index for index, line in enumerate(lines) if line.rstrip("\r\n") == "projects:"), None)
if start is None:
    raise SystemExit("Serena configuration has no top-level projects list")

def scalar_value(value: str) -> str:
    value = value.strip()
    if value.startswith('"') and value.endswith('"'):
        return json.loads(value)
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    return value

removed = False
index = start + 1
while index < len(lines):
    stripped = lines[index].strip()
    if stripped and not stripped.startswith("#") and not lines[index].startswith((" ", "\t", "-")):
        break
    if stripped.startswith("-"):
        value = scalar_value(stripped[1:])
        if os.path.realpath(value) == target:
            del lines[index]
            removed = True
            continue
    index += 1

if removed:
    file_descriptor, temporary_path = tempfile.mkstemp(dir=config_path.parent, prefix=f".{config_path.name}.")
    try:
        with os.fdopen(file_descriptor, "w") as temporary_file:
            temporary_file.writelines(lines)
        os.chmod(temporary_path, config_path.stat().st_mode)
        os.replace(temporary_path, config_path)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)
print("removed" if removed else "not-found")
PY
  )
  [[ "$result" == "removed" ]] && removed=true
fi

remove_args=()
[[ "$force" == true ]] && remove_args+=(--force)
if ! git -C "$project_root" worktree remove "${remove_args[@]}" "$target"; then
  if [[ "$removed" == true ]]; then
    cp -p "$backup" "$serena_config"
    printf 'Restored Serena project registration after Git worktree removal failed.\n' >&2
  fi
  [[ -n "$backup" ]] && rm -f "$backup"
  exit 1
fi

[[ -n "$backup" ]] && rm -f "$backup"
printf 'Removed worktree and Serena project registration: %s\n' "$target"
