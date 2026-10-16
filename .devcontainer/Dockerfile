FROM node:26-trixie

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest
ARG PLAYWRIGHT_MCP_VERSION=0.0.83
# To upgrade, update the version and both hashes from that release's gitleaks_<version>_checksums.txt
ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SHA256_X64=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
ARG GITLEAKS_SHA256_ARM64=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  procps \
  sudo \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# gitleaks, for the pre-commit secret scan (see .devcontainer/pre-commit)
RUN case "$(dpkg --print-architecture)" in \
    amd64) arch=x64; sha="$GITLEAKS_SHA256_X64" ;; \
    arm64) arch=arm64; sha="$GITLEAKS_SHA256_ARM64" ;; \
    *) echo "No gitleaks build for this architecture" && exit 1 ;; \
  esac && \
  tarball="gitleaks_${GITLEAKS_VERSION}_linux_${arch}.tar.gz" && \
  curl -fsSL -o "/tmp/$tarball" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/$tarball" && \
  echo "$sha  /tmp/$tarball" | sha256sum -c - && \
  tar -xzf "/tmp/$tarball" -C /usr/local/bin gitleaks && \
  rm "/tmp/$tarball"

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

ENV EDITOR=nano
ENV VISUAL=nano

# Global npm packages live somewhere the node user can write to
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Create workspace, config and history directories, and persist bash history
RUN mkdir -p /usr/local/share/npm-global /workspace/node_modules /home/node/.claude /commandhistory && \
  touch /commandhistory/.bash_history && \
  chown -R node:node /usr/local/share /workspace /home/node/.claude /commandhistory && \
  echo "export PROMPT_COMMAND='history -a' HISTFILE=/commandhistory/.bash_history" >> /home/node/.bashrc

WORKDIR /workspace

# Claude Code CLI, so `claude` works in the container terminal (the VS Code extension bundles its own)
USER node
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Install Playwright MCP server, plus the Chromium build its bundled Playwright expects
# (the firewall blocks Playwright's CDN, so browsers can't be downloaded at runtime)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g @playwright/mcp@${PLAYWRIGHT_MCP_VERSION}

USER root
RUN mkdir -p /ms-playwright && \
  node /usr/local/share/npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright/cli.js \
    install --with-deps chromium && \
  chown -R node:node /ms-playwright

# Firewall script and its allowlist, root-owned and runnable by node via sudo.
# Baked into the image so nothing in the workspace can widen the allowlist; edit and rebuild to change it.
COPY allowed-domains.txt /etc/claude-sandbox/allowed-domains.txt
COPY init-firewall.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/init-firewall.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall

USER node
