#!/bin/bash
# Runs on the host before the container starts (devcontainer.json's initializeCommand).
# Must work with macOS's bash 3.2. Checks .git before running any git command in it, since
# code in the container can write most of .git.
set -euo pipefail

# Code in the container can't touch .git/config or .git/hooks, but these are the known ways it
# could still get git on the host to load a config or hook it wrote. Refuse to start until
# someone has looked.
problems=""
[ -e .git/commondir ] && problems="$problems
  .git/commondir: points git at a different config and hooks directory"
[ -e .git/modules ] && problems="$problems
  .git/modules: submodule configs, which the container can write"
while IFS= read -r -d '' nested; do
  problems="$problems
  $nested: a nested repository with its own config"
done < <(find . \( -name node_modules -o -path ./.git \) -prune -o -name .git -print0)

if [ -n "$problems" ]; then
  echo "claude-sandbox: refusing to start. Found:$problems" >&2
  echo "Don't run git in this folder on the host until you've checked and removed these." >&2
  exit 1
fi

[ -e .git ] || git init -q
# The read-only mounts need these paths to exist
mkdir -p .git/hooks .vscode

# Install the gitleaks pre-commit hook. .git/hooks is read-only inside the container, so it has
# to be put there from the host.
hook=.git/hooks/pre-commit
if [ ! -e "$hook" ] || grep -q "claude-sandbox gitleaks hook" "$hook"; then
  cp .devcontainer/pre-commit "$hook"
  chmod +x "$hook"
else
  echo "claude-sandbox: $hook already exists, so the gitleaks hook wasn't installed. Add the" >&2
  echo "gitleaks command from .devcontainer/pre-commit to your hook yourself." >&2
fi
if [ -n "$(git config --get core.hooksPath || true)" ]; then
  echo "claude-sandbox: core.hooksPath is set, so git won't run the gitleaks hook in .git/hooks." >&2
fi
