# claude-sandbox

A VS Code dev container for running Claude Code in auto mode with its network locked down. Claude works on branches and opens PRs from inside the container, and you review and merge them on GitHub.

It started from Anthropic's [reference dev container](https://github.com/anthropics/claude-code/tree/main/.devcontainer) ([docs](https://code.claude.com/docs/en/devcontainer)). Changes from it include: the allowlist moved into a file baked into the image, IPv6 blocked, DNS limited to the container's resolvers, the container stopping if the firewall fails, read-only mounts protecting host-trusted files, Playwright MCP with Chromium, a scoped GitHub token instead of your own credentials, and a gitleaks pre-commit hook.

## What's inside

- Node 26 on Debian trixie, with `gh`, gitleaks, Claude Code (the `claude` CLI plus the VS Code extension), and the Playwright MCP server with Chromium baked in.
- An outbound firewall (`init-firewall.sh`). It allows GitHub, the domains in `allowed-domains.txt`, and DNS to the container's own resolvers, and rejects everything else, including all IPv6. If the firewall setup fails, the container stops instead of running unprotected.
- Read-only mounts over the files your Mac executes or trusts: `.devcontainer/`, `.git/hooks`, `.git/config` and `.vscode/`. Without them, code inside the container could edit its own sandbox (which takes effect on the next rebuild) or plant a git hook that runs the next time you commit from the host. Before each start, `initialize.sh` also checks for other ways into host git (see [Known limits](#known-limits)).
- Git in the container pushes with a fine-grained token you create for it, never your own GitHub credentials.
- A pre-commit hook that runs gitleaks on staged changes and blocks commits that look like they contain a secret.
- Claude config, shell history and `node_modules` live in Docker volumes, one set per project.

## Setup

### Once

1. **Create a GitHub token for the sandbox.** Go to GitHub → Settings → Developer settings → Fine-grained tokens:
   - **Repository access:** "Only select repositories". Add each sandbox project as you create it.
   - **Permissions:** Contents: read and write, Pull requests: read and write. Leave Workflows off, so Claude can't push changes to `.github/workflows`.
2. **Make the token available to VS Code** as `SANDBOX_GH_TOKEN`. Keeping it in the macOS keychain avoids a plaintext copy in your shell config:
   ```sh
   security add-generic-password -a "$USER" -s sandbox-gh-token -w   # paste the token when prompted
   echo 'export SANDBOX_GH_TOKEN=$(security find-generic-password -s sandbox-gh-token -w)' >> ~/.zshrc
   ```
   Then quit and reopen VS Code completely so it picks up the variable.
3. **Stop VS Code passing your own credentials into containers.** In VS Code user settings, set `"dev.containers.gitCredentialHelperConfigLocation": "none"`. The container already ignores them for github.com; this covers every other host too.

### Each new project

```sh
gh repo create my-thing --template suitecake/claude-sandbox --public --clone
```

Then:

1. **Add the repo to the sandbox token** (Repository access on the token's settings page).
2. **Protect `main`.** In the repo, go to Settings → Rules → Rulesets → New branch ruleset. Target the default branch and turn on "Restrict deletions", "Require a pull request before merging" and "Block force pushes". Leave the bypass list empty. Without this, Claude's token can push straight to `main`.
3. **Check push protection.** Under Settings → Code security, make sure "Push protection" is on. It's on by default for public repos. It rejects pushes containing known token formats.
4. Fill in `README.md` and `CLAUDE.md` at the root.
5. In VS Code, run **Dev Containers: Reopen in Container**.

### Existing project

```sh
npx degit suitecake/claude-sandbox/.devcontainer .devcontainer
# optional: Playwright MCP config and starter CLAUDE.md
gh api repos/suitecake/claude-sandbox/contents/.mcp.json -H "Accept: application/vnd.github.raw" > .mcp.json
gh api repos/suitecake/claude-sandbox/contents/CLAUDE.md -H "Accept: application/vnd.github.raw" > CLAUDE.md
```

Then do the per-project steps above. If the folder isn't a git repo yet, it gets `git init` on first open.

## Day to day

- **Open the project straight into the container**, using the **[Dev Container]** entry in VS Code's recent list, or `code` and then Reopen in Container. Opening the folder in a plain local window runs VS Code's git extension on your Mac against the container-written `.git`.
- **Review and merge on GitHub.** If you want to work on the code on your Mac, use a separate clone, not this folder.
- `.mcp.json` points at `playwright-mcp`, which only exists inside the container. Claude Code on the host will report that the server failed to connect. That's expected.

## Customizing per project

- **Network:** add domains to `allowed-domains.txt`, then rebuild. The list is baked into the image, so nothing inside the container can widen it. npm packages that download binaries from GitHub releases during install need `objects.githubusercontent.com` and `release-assets.githubusercontent.com`.
- **Not a Node project?** The `npm install` step is skipped when there's no `package.json`. You can also drop the `node_modules` volume and the Prettier settings from `devcontainer.json`.
- **Versions:** pin Claude Code, Playwright MCP and gitleaks with the `ARG`s at the top of the `Dockerfile`.
- **gitleaks false positives:** add the finding's fingerprint to `.gitleaksignore`, or tune rules in `.gitleaks.toml`, at the repo root.

## Working with git inside the container

Because `.git/config` is read-only inside the container, commands that write git config fail there:

- `git push -u` pushes fine but then errors out setting the upstream. Use `git push origin HEAD`, or set the upstream once from the host.
- `git remote add`, `git config …`, and `git checkout -b x origin/x` fail. Run them on the host.

After you change git config on the host, restart the container so it sees the new file.

If the container won't start and `initialize.sh` says it found `.git/commondir`, `.git/modules` or a nested `.git`, something in the container wrote it. Look at it and delete it before running any git command in that folder on your Mac.

## Known limits

This setup keeps an agent from wandering off. It is not a vault for secrets.

- **Anything in the container can end up in a public PR.** Claude can read every file in the workspace, including `.env`, and every environment variable, including `GH_TOKEN`. gitleaks and push protection catch common token formats, not everything. Only put dev-grade secrets in the sandbox (test-mode keys, spending caps, dev databases), and if one is ever pushed, rotate it. Deleting it from history doesn't help once it's public.
- **All of GitHub is reachable.** The token limits what git and `gh` can push, but code in the container can still upload data to GitHub using some other account's credentials.
- **DNS is open** to the container's resolvers, so small amounts of data could leak out through DNS queries.
- **Allowed domains are resolved to IPs once, at startup.** Domains behind CDNs, such as `registry.npmjs.org`, change IPs over time. If installs start failing in a long-running container, restart it.
- **Host git checks cover known attacks, not every possible one.** The read-only mounts and `initialize.sh` block the known ways for the container to get host git to run its code. The rest of `.git` is still writable, so the safest habit is to not run git in this folder on your Mac.
- **Other workspace files still run on your Mac.** `package.json` scripts, `.mcp.json`, and `.claude/settings.json` hooks all run with your full permissions if you use them on the host. Review changes to them before you do.
