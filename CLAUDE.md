# CLAUDE.md

## Project

HORSE: a browser platformer with a level editor. Build a level, beat it to unlock sharing, send the link, get your friend's attempts back as ghosts. No backend; levels and replays live in the URL hash. TypeScript + Vite + HTML canvas, no game engine or UI framework. See README.md for the design.

- `src/sim.ts` must stay deterministic: integer math only, no floats, `Math.random`, or time. Replays depend on it.
- Changing physics constants or the binary formats in `share.ts`/`replay.ts` breaks existing links. Bump the version byte if you change a format.
- `tests/core.test.ts` has a known winning run for the starter level; if physics changes break it, retune or re-solve rather than deleting it.

## Commands

- Dev server: `npm run dev` (port 5173). `/sprites.html` shows the sprite sheet.
- Tests: `npm test` (vitest)
- Typecheck and build: `npm run build`

## Sandbox

You're running in a dev container with an outbound firewall (see `.devcontainer/README.md`). Connections to domains not in `.devcontainer/allowed-domains.txt` are rejected. If you need a new domain, ask; don't try to work around the firewall. `.devcontainer/`, `.vscode/`, `.git/config` and `.git/hooks` are read-only.

## Git and GitHub

This repo is public. Anything pushed, on any branch or in any PR, is visible to everyone.

- Never commit to or push `main`. Do work on a branch: `git switch -c <name>`.
- Push with `git push origin HEAD`. `git push -u`, `git remote add`, `git config` and other commands that write git config fail here because `.git/config` is read-only.
- Open PRs with `gh pr create`. Don't merge them; the user reviews and merges.
- A pre-commit hook scans staged changes with gitleaks. If it blocks a commit, remove the secret from the change. Never use `--no-verify`, add `gitleaks:allow` comments, or edit `.gitleaksignore` or `.gitleaks.toml` without asking first.
- Never put secret values in tracked files, including tests, fixtures, docs and scripts. Read them from environment variables or `.env` (gitignored), and put placeholder values in `.env.example`.
