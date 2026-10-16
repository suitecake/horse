# CLAUDE.md

## Project

TODO: what this app does, and its stack.

## Commands

- Dev server: TODO
- Tests: TODO
- Lint and format: TODO

## Sandbox

You're running in a dev container with an outbound firewall (see `.devcontainer/README.md`). Connections to domains not in `.devcontainer/allowed-domains.txt` are rejected. If you need a new domain, ask; don't try to work around the firewall. `.devcontainer/`, `.vscode/`, `.git/config` and `.git/hooks` are read-only.

## Git and GitHub

This repo is public. Anything pushed, on any branch or in any PR, is visible to everyone.

- Never commit to or push `main`. Do work on a branch: `git switch -c <name>`.
- Push with `git push origin HEAD`. `git push -u`, `git remote add`, `git config` and other commands that write git config fail here because `.git/config` is read-only.
- Open PRs with `gh pr create`. Don't merge them; the user reviews and merges.
- A pre-commit hook scans staged changes with gitleaks. If it blocks a commit, remove the secret from the change. Never use `--no-verify`, add `gitleaks:allow` comments, or edit `.gitleaksignore` or `.gitleaks.toml` without asking first.
- Never put secret values in tracked files, including tests, fixtures, docs and scripts. Read them from environment variables or `.env` (gitignored), and put placeholder values in `.env.example`.
