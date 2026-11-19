# telegram-agent-bot

A Telegram bot that gives every allowed Telegram account its own Claude Code agent (the `claude` CLI running in a
Cloudflare container), with per-account memory and sessions (one forum topic = one session). Built with Effect 4 and
Alchemy v2 on Cloudflare Workers, Durable Objects, R2 and KV. Product spec: `docs/spec.md`; architecture and
package rules: `docs/architecture.md`.

```
Telegram -> Gateway Worker -> UserAgent Durable Object (1 per tgId, SQLite) -> container (claude CLI)
                                  R2: agents/<tgId>/ snapshots, car/<tgId>/ data     KV: allowlist, plugin flags
Gateway also serves /mcp (plugin tools for the agent), /health, and a 6-hourly cron healthcheck.
```

## Setup (once)

1. **Bot.** In BotFather create the bot (a second one for the `dev` stage), then enable **Topics in private chats**
   (Bot Settings -> Threaded mode / Topics). Topics are how `/new` creates sessions.
2. **Claude token.** On a machine where you are logged in to your Claude subscription run `claude setup-token`.
   The token is valid for about a year. Note the date for `CLAUDE_TOKEN_ISSUED_AT`; the bot reminds the admin
   30, 7 and 1 days before it expires.
3. **Proton Pass.** Create items in the vault `Agents` matching the `pass://Agents/<item>/<field>` references in
   `.env.example` (Cloudflare API token + account id, Telegram bot token + webhook secret, Claude token, MCP token
   secret). Copy `.env.example` to `.env`. Nothing secret is stored in the repo.
   The webhook secret and MCP secret are random strings (`openssl rand -hex 32`).
4. **Cloudflare auth.** `alchemy profile edit --add Cloudflare`, or use `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID`. The token needs Workers, Containers, R2, KV, Secrets Store and account API token
   write (R2 presigned URLs mint a bucket-scoped token). Docker must be available (the container image is built
   and pushed during deploy).
5. **State store.** Once, locally: `pp run --env-file .env -- pnpm exec alchemy state bootstrap`. CI cannot create
   it itself.
6. `pnpm install`.

## Develop

```
pnpm typecheck        # all packages, then alchemy.run.ts
pnpm test
pp run --env-file .env -- pnpm infra:dev     # local workerd with live reload
```

## Deploy

```
pp run --env-file .env -- pnpm exec alchemy plan   --stage dev
pp run --env-file .env -- pnpm exec alchemy deploy --stage dev --yes
pp run --env-file .env -- pnpm exec alchemy destroy --stage pr-42 --yes
```

After deploy: `SMOKE_BASE_URL=<worker url> pp run --env-file .env -- pnpm smoke`.
Allow other users from the admin chat with `/allow <tgId>`.

### Stages

| Stage | Webhook | Bot |
|---|---|---|
| `dev` | registered | the test bot (use the dev bot's token in `.env`) |
| `prod` | registered | the real bot |
| `pr-<n>` | **not** registered (a bot has a single webhook) | n/a; use the Worker URL directly |

Each stage has its own Worker, Durable Objects, container application, R2 bucket and KV namespace.

### CI (`.github/workflows/deploy.yml`)

push to `main` deploys `prod`; a pull request deploys `pr-<n>`; closing the PR destroys it. After each deploy
`scripts/smoke.ts` checks `/health`, that a wrong webhook secret gets 403, and that a synthetic admin "ping"
update is accepted. Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `CLAUDE_CODE_OAUTH_TOKEN`, `MCP_TOKEN_SECRET`. Repository variables: `ADMIN_TG_ID`,
`DAILY_RUN_LIMIT`, `CONTAINER_INSTANCE_TYPE`, `CLAUDE_TOKEN_ISSUED_AT`.

## Configuration

| Name | Kind | Default |
|---|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CLAUDE_CODE_OAUTH_TOKEN`, `MCP_TOKEN_SECRET` | secret | required |
| `ADMIN_TG_ID` | plain | required |
| `DAILY_RUN_LIMIT` | plain | 50 runs per account per UTC day |
| `CONTAINER_INSTANCE_TYPE` | plain | `basic` |
| `CLAUDE_TOKEN_ISSUED_AT` | plain | empty (no expiry reminders) |

## Add a plugin

1. Create `packages/plugins/<name>` exporting a `BotPlugin` (`@bot/core-contracts/plugin`): `id`, `commands`,
   `callbacks`, `tools` (served to the agent over MCP, scoped to the caller's tgId), `layer`, `systemPrompt`,
   `enabledByDefault`.
2. Add it to the array in `apps/gateway/src/plugins.ts` (the only registration point) and as a dependency of
   `@bot/gateway`. If its layer needs new bindings, add them to `apps/gateway/src/env.ts`,
   `apps/gateway/src/layers.ts` and `alchemy.run.ts`.
3. Its commands appear in `/help` and in the Telegram menu automatically (the next deploy updates `setMyCommands`).
   The admin enables it per account with `/plugins`.
