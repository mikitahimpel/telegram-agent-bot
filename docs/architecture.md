# Architecture

Spec: `docs/spec.md`. Research notes (verified against live docs): `docs/research/*.md`.

```
Telegram → apps/gateway (Worker) → UserAgent DO (1 per tgId, SQLite) → Sandbox (1 per DO, claude CLI)
                                      ↘ R2 (agents/<tgId>/ ~/.claude snapshots, car/<tgId>/ data)  KV (allowlist, plugin flags)
                         Worker also serves /mcp (plugin tools, bearer token bound to tgId)
```

## Stack (pinned)

- effect 4.1.4 (stable v4: `Context.Service`, `Schema`, `Data.TaggedError`, `Data.TaggedEnum`, `effect/http`)
- alchemy 2.0.0-beta.87, @cloudflare/sandbox 1.0.3, @anthropic-ai/claude-code 2.1.328
- Telegram Bot API 10.4 (2026-11-09)
- pnpm workspaces, `catalog:` versions in `pnpm-workspace.yaml`
- Toolchain: Vite+ (`vite-plus` 1.7.0, `vp` CLI). One root `vite.config.ts` holds the Oxlint (`lint`) and Oxfmt (`fmt`) config; `vp test` (bundled Vitest 5 + @effect/vitest) per package, `vp build` for apps/car-web, `vp check` = format + lint + type-aware check. `vp run -r <script>` runs a script across the workspace. `tsc -p .` / `vue-tsc` stay as the `typecheck` scripts (Vue SFCs and the alchemy files).
- Lint rules: Oxlint correctness set, `typescript/consistent-type-definitions: type`, `typescript/no-explicit-any` (off for `test/`; src exceptions carry `oxlint-disable-next-line`). Format: no semicolons, double quotes, 2 spaces, width 120, no trailing commas. Imports of vitest go through `vite-plus/test`.
- CI (`.github/workflows/deploy.yml`): `voidzero-dev/setup-vp`, then `vp check`, `vp run typecheck`, `vp run test`, `vp run build`, then deploy.

## Layout — `packages/<context>/<feature>`, one package per feature

| Package                         | Name                        | Contents                                                                                                                                                                       |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| packages/core/contracts         | @bot/core-contracts         | ids, tagged errors, Lang/i18n helper, AgentEvent, service tags (no implementations)                                                                                            |
| packages/telegram/schema        | @bot/telegram-schema        | Effect Schema for incoming Update & friends                                                                                                                                    |
| packages/telegram/client        | @bot/telegram-client        | `Telegram` Layer over `effect/http` HttpClient, 429 retry via Schedule                                                                                                         |
| packages/telegram/format        | @bot/telegram-format        | HTML escape, markdown→Telegram HTML, splitting ≤4096, rich-message builders (tables)                                                                                           |
| packages/telegram/streaming     | @bot/telegram-streaming     | Stream<AgentEvent> → drafts (sendMessageDraft, can_stop) + final message(s); editMessageText fallback                                                                          |
| packages/bot/commands           | @bot/bot-commands           | registry, /help builder, setMyCommands payloads (default + admin chat scope, ru+en)                                                                                            |
| packages/bot/core-commands      | @bot/bot-core-commands      | handlers: start help new sessions stop lang + admin agents usage allow revoke kill restart                                                                                     |
| packages/bot/allowlist          | @bot/bot-allowlist          | `Allowlist` Layer on KV                                                                                                                                                        |
| packages/bot/invites            | @bot/bot-invites            | `Invites` on admin DO SQLite (+ memory layer), /invite /invites, invite redemption flow                                                                                        |
| packages/bot/memory             | @bot/bot-memory             | long-term user facts in DO SQLite (2000-token budget), `UserMemory` service; rendered as a `MEMORY [n/2000 tokens]` block appended after the stable system prompt on every run |
| packages/plugins/memory         | @bot/plugins-memory         | memory plugin: memory_remember/update/forget/list tools, /memory command with forget buttons                                                                                   |
| packages/bot/dispatcher         | @bot/bot-dispatcher         | decoded Update → command / callback / agent prompt / stop routing                                                                                                              |
| packages/agent/stream-json      | @bot/agent-stream-json      | Schema for claude CLI stream-json lines → AgentEvent; usage-limit detection                                                                                                    |
| packages/agent/runner           | @bot/agent-runner           | `AgentRunner` Layer over @cloudflare/sandbox; R2 snapshot/restore                                                                                                              |
| packages/agent/sessions         | @bot/agent-sessions         | `Sessions` Layer over DO SQLite storage                                                                                                                                        |
| packages/plugins/registry       | @bot/plugins-registry       | plugin registry, plugin flags (KV), MCP JSON-RPC server, MCP token (HMAC)                                                                                                      |
| packages/plugins/car            | @bot/plugins-car            | car plugin (commands + tools), R2 `car/<tgId>/`                                                                                                                                |
| packages/infra/telegram-webhook | @bot/infra-telegram-webhook | Alchemy custom resource: setWebhook+setMyCommands / deleteWebhook                                                                                                              |
| apps/gateway                    | @bot/gateway                | Worker fetch handler, UserAgent DO, Sandbox DO export, wiring of all Layers                                                                                                    |
| apps/claude-runner              | —                           | Dockerfile for the sandbox image (claude CLI + python (pandas, matplotlib))                                                                                                    |
| alchemy.run.ts                  | —                           | all infrastructure, stages dev/prod/pr-N                                                                                                                                       |

## Rules

- No comments in code (no JSDoc, no inline). Only tool directives are allowed (`@ts-expect-error`, `/// <reference>`, `eslint-disable`). Explain intent with names and types; put design notes in docs/.
- kebab-case files/folders; PascalCase classes/services. No `any` except where contracts already use it. No barrel index.ts: `exports` in package.json lists subpaths, each maps to one `src/<name>.ts`.
- Imports between packages only through declared `exports`; add the dependency (`"@bot/x": "workspace:*"`) to package.json.
- Services: `class X extends Context.Service<X, Shape>()("@bot/X") {}` from contracts; implementations export `layer` (and `layerTest`/mock helpers for tests).
- Errors: `Data.TaggedError` from `@bot/core-contracts/errors`. Domain values: `Data.TaggedClass` / `Data.TaggedEnum`.
- Config (effect 4.1.4 constructors are capitalised): `Config.Redacted("TELEGRAM_BOT_TOKEN")`, `Config.String`, `Config.Int`, `Config.withDefault`. Never log secrets.
- i18n: every user-facing string goes through a per-package catalog made with `defineMessages` from `@bot/core-contracts/lang` (ru + en). Lang = user's `/lang` choice (Sessions.getLang) else `langFromTelegram(from.language_code)`.
- Telegram output is HTML parse_mode; escape all dynamic text.
- Each package: `package.json`, `tsconfig.json` (`extends ../../../tsconfig.base.json`), `src/`, `test/` with vitest tests using mock Layers. `vp run --filter <name> typecheck` and `test` must pass; `vp check` must be clean.
- The Claude OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) is only passed as env to the `claude` CLI inside the sandbox. Never call Anthropic API with it.
