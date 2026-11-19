# claude-runner (sandbox image)

Image for the per-user container owned by the `UserAgent` Durable Object (`@bot/agent-runner`).

Contents: node 24 (Debian trixie), `@anthropic-ai/claude-code` (pinned), python3 + pandas/matplotlib,
git/curl/jq, `sandbox-shim` (required by `@cloudflare/sandbox` `Files`/`DirectoryBackup`), user `node` (uid 1000),
`/workspace` (cwd of every run) and `/workspace/out` (files the agent saves there are sent to the user).

No secrets are baked in. `CLAUDE_CODE_OAUTH_TOKEN` is passed per `exec` by the runner. `IS_SANDBOX=1` is not set:
the CLI runs as non-root and uses `--permission-mode dontAsk` instead of `--dangerously-skip-permissions`.

## How it is used
- Infra (alchemy/wrangler) builds this Dockerfile as image `workspace` (`containers[].images.workspace`) with
  `scheduling_policy: "durable_object"`. The runner starts it with `container.start({ image: container.images.workspace,
  instance: CONTAINER_INSTANCE_TYPE, enableInternet: true })` (default `basic`; set the same size in infra if it is declared there).
- `~/.claude` and `/workspace` are persisted to R2 (`agents/<tgId>/`) by `DirectoryBackup` and restored on cold start.

## Bump the Claude Code version
1. Change `ARG CLAUDE_CODE_VERSION` in `Dockerfile` (and the version in `docs/architecture.md`).
2. Re-check `docs/research/sandbox-claude.md` assumptions (stream-json shapes, limit/auth messages) and
   `packages/agent/stream-json` fixtures against the new version.
3. Redeploy; running containers keep the old image until they sleep and restart.

## Bump the sandbox SDK
`FROM docker.io/cloudflare/sandbox:<tag>` must match the `@cloudflare/sandbox` version in `packages/agent/runner/package.json`.

## Not built locally
Written without a local Docker; validate with `docker build -t claude-runner apps/claude-runner` and
`docker run --rm claude-runner claude --version && docker run --rm claude-runner sandbox-shim --help`.
