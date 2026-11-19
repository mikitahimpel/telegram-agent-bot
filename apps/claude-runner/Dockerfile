# Sandbox image: Claude Code CLI + python data tooling. Driven by the UserAgent Durable Object
# through ctx.container.exec(); see README.md.
# `sandbox-shim` (used by Files/DirectoryBackup in @cloudflare/sandbox) is copied from the official
# image; keep its tag equal to the pinned @cloudflare/sandbox version.
FROM docker.io/cloudflare/sandbox:1.0.3 AS sandbox-shim

FROM node:24-trixie-slim

COPY --from=sandbox-shim /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git curl jq ca-certificates tar zstd procps \
      python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

# Debian's python is "externally managed"; this is a throwaway container, so install system-wide.
RUN pip3 install --no-cache-dir --break-system-packages pandas matplotlib

# Keep in sync with docs/architecture.md (claude 2.1.328).
ARG CLAUDE_CODE_VERSION=2.1.328
RUN npm i -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# The base image already has user `node` (uid/gid 1000); the runner execs claude as 1000:1000 with HOME=/home/node.
RUN mkdir -p /workspace/out /home/node/.claude \
 && chown -R 1000:1000 /workspace /home/node

WORKDIR /workspace
CMD ["sleep", "infinity"]
