# Working in this repository

A Telegram bot that gives each allowed account its own Claude Code agent in a Cloudflare container, plus a car
OBD-II plugin and a Chrome PWA. Effect 4.1.4, Alchemy v2, Cloudflare Workers/Durable Objects/R2/KV, Vue 3, Vite+.

## Read first

1. `docs/operations.md`: deploy, configuration, debugging in production, traps we already hit, what is not verified.
2. `docs/architecture.md`: package layout and rules.
3. `docs/spec.md` (product), `docs/car-web.md` (car app), `docs/research/` (background notes).

## Commands

- `vp check` format, lint and type-aware check (`vp check --fix` to apply)
- `vp run typecheck`, `vp run test`, `vp run build`, `vp run e2e` (car web)
- In one package: `vp test run`. The car recorder tests are timing sensitive and retry on purpose.
- Run all of `vp check`, `vp run typecheck` and `vp run test` before every push: a failing check blocks the deploy.

## Rules

- Layout `packages/<context>/<feature>`; contracts live in `@bot/core-contracts`. One package per feature.
- Effect v4 style already in the code: `Context.Service`, `Layer`, `Data.TaggedError`, `Data.TaggedEnum`, `Schema`,
  capitalised `Config` constructors. No `any` (a directive is allowed on genuine generic boundaries).
- Prefer `type` aliases over `interface`. kebab-case file names.
- No comments in code, only tool directives (`@ts-expect-error`, `oxlint-disable-next-line`, `/// <reference>`).
  Explain intent with names and types, and put design notes in `docs/`.
- Every user-facing string is Russian and English through `defineMessages`. Users are non-technical: never show
  words like session, tool, model, token or MCP to them.
- Secrets never go in the repo. Local values are `pass://` references in `.env` (see `.env.example`).
- Do not add dependencies casually: re-resolving the lockfile once broke test loading. Vendor small assets.
- When several agents work in the same tree, stage only your own files; never `git add -A` then.

## Where things are

- Agent runtime: `packages/agent/*` (runner, stream-json, sessions). Prompt assembly: `runner.ts` and the gateway's
  `PluginPrompts` layer. Model routing: `packages/agent/runner/src/model-routing.ts`.
- Bot flow: `packages/bot/*` (dispatcher, commands, invites, memory, scheduler). Gateway and Durable Object:
  `apps/gateway`. Infra definition: `alchemy.run.ts`. CI: `.github/workflows/deploy.yml`.
- Plugins: `packages/plugins/*` (car, reminders, memory). Car data: `packages/car/*`. Car app: `apps/car-web`.

## Useful skills when available

`cloudflare:durable-objects`, `cloudflare:workers-best-practices`, `cloudflare:sandbox-stable` or `sandbox-next`,
`cloudflare:agents-sdk`, `cloudflare:wrangler` for the platform; `designer:designer` for any UI work.
