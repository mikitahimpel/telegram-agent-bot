# Operations and lessons learned

How the deployed bot is run, what it needs, and the traps we already fell into. No secrets or personal data here.

## Deploy

- Every push to `main` runs `.github/workflows/deploy.yml`: `vp check`, typecheck, tests, build, then
  `alchemy deploy --stage prod`, then a smoke test. A pull request deploys a `pr-<n>` stage and destroys it on close.
- A failing check blocks the deploy, so a broken commit never reaches production. The last good deploy keeps running.
- Docs-only changes do not deploy (see `paths-ignore` in the workflow).
- Re-run without a commit (for example after changing a repository variable): `gh run rerun <run-id>`.

## Configuration

Secrets (GitHub Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `MCP_TOKEN_SECRET`, and `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY` in api_key mode).

Variables (GitHub Actions, all optional except the first two):

| Variable                     | Default                         | Meaning                                                                     |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `ADMIN_TG_ID`                | required                        | Telegram id of the admin                                                    |
| `BOT_USERNAME`               | required                        | Bot username without `@`, baked into the car web build for deep links       |
| `CLAUDE_AUTH_MODE`           | `subscription`                  | `subscription` or `api_key`                                                 |
| `CLAUDE_MODEL`               | `claude-sonnet-5-5`             | Fast model for everyday chat                                                |
| `CLAUDE_MODEL_DEEP`          | `claude-opus-5-5`               | Model for heavy tasks (attachments, long text, car, charts, analysis, code) |
| `AGENT_THINKING_TOKENS`      | `0`                             | Thinking budget for the fast model                                          |
| `AGENT_THINKING_TOKENS_DEEP` | `4000`                          | Thinking budget for the deep model                                          |
| `DAILY_RUN_LIMIT`            | `50` (set to 100 in production) | Default requests per user per day                                           |
| `CLAUDE_TOKEN_ISSUED_AT`     | empty                           | ISO date of `claude setup-token`; drives expiry reminders                   |
| `CONTAINER_INSTANCE_TYPE`    | `basic`                         | Container size                                                              |
| `AGENT_INACTIVITY_TIMEOUT`   | `30m`                           | How long an idle container stays warm                                       |

Model routing lives in `packages/agent/runner/src/model-routing.ts` (a keyword and size heuristic, unit tested).

### Cloudflare API token permissions

The deploy token needs, at account level: Workers Scripts, Workers KV Storage, Workers R2 Storage, Containers,
Workers Observability, D1, Secrets Store (alchemy keeps its state there), Workers AI (voice transcription) and
Account API Tokens: Edit (alchemy mints a bucket-scoped R2 token for presigned upload URLs). It also needs Workers
Routes on zones. The token is long-lived: prefer a dedicated token per project.

## Admin commands

`/invite [uses=N] [ttl=7d] [plugins=car] ["note"]`, `/invites`, `/allow`, `/revoke`, `/plugins <tgId>`,
`/usage [tgId]`, `/agents`, `/kill`, `/restart`, `/limit <tgId> <n|default>` (per-user daily limit, effective
immediately), `/context` (shows exactly what the agent is told about its abilities and plugins; the first thing to
run when the assistant behaves as if it does not know a feature).

Plugin enablement is stored per user in KV under `plugins:<tgId>` as a JSON object, falling back to the plugin's
`enabledByDefault`. The car plugin is currently enabled by default; flip it in `packages/plugins/car/src/car.ts`
and pin existing users first by writing `{"car":true}` to their keys.

## Debugging production

- Worker logs: the Cloudflare Workers Observability telemetry query API (`POST /accounts/<id>/workers/observability/
  telemetry/query`, `view: "events"`, filter on `$metadata.service`). MCP tool failures are logged as
  `mcp tool failed` / `mcp tool defect`; before that was added, tool errors vanished silently.
- A run that ends in an error shows the user a localized "something went wrong"; the raw error goes to the admin
  as a private notice.
- `/context` for prompt problems, `/usage` for limits.

## Traps we hit (do not repeat)

- **Smoke test.** It must never post a real message as the admin. It once sent text "ping" as the admin, the agent
  answered "pong" in the admin's chat after every deploy. It now posts an update without a sender.
- **Worker origin.** The car web URL (`CAR_WEB_URL`) is derived from the request origin. Code that does not run in a
  Durable Object (the `/mcp` and `/car/api` runtimes) must pass `origin` to `pluginEnvironment(env, origin)`; the
  config layer passed to the outer `Layer.provide` is overridden by the inner one.
- **Plugin prompts.** `registry.systemPromptFor` is not used; the prompt the agent sees is assembled by the
  `PluginPrompts` service (enabled plugins' blurbs and guides) and appended before memory and the date.
- **Lockfile.** Adding any dependency re-resolved `pnpm-lock.yaml` and detached vitest from the Vite+ core, which made
  every `@effect/vitest` suite fail to load ("Cannot read properties of undefined (reading 'config')"). Check
  `vp run test` after touching dependencies; vendor small assets (the display font is bundled in
  `apps/car-web/src/assets/fonts`) instead of adding packages.
- **Flaky timing tests.** `packages/car/recorder` tests mix a fake clock with real waits and are sensitive to load;
  the package config uses `retry: 3` and a long timeout. Do not "fix" them by lengthening real waits.
- **Committing with parallel agents.** `git add -A` swept another agent's unfinished work into a pushed commit. Add
  only your own paths while others are editing.
- **Docs and Telegram HTML.** A link inside `<code>` is not clickable; invite links are plain text plus a Share
  button.
- **Whisper.** Language auto-detection misreads short Russian clips as Czech or Polish; the speech service retries
  with a Russian hint when it detects a Slavic language that is not ru, uk or be.

## Not verified end to end (as of the last session)

These work in unit tests and the demo mode but have not been exercised against real traffic or hardware:

- A real ELM327 BLE adapter and a real drive (everything was tested against the simulator). Chrome's Web Bluetooth
  auto-reconnect behaviour on Android is unconfirmed.
- Reminders firing, `/memory`, invites redemption by another person, photo and document analysis, the weekly car
  summary, trip notifications.
- Live gauges on the recording screen in auto mode are empty; the overview "last trip" card only shows trips
  recorded on the same phone.
- Billing/limits: the exact text of a subscription usage-limit or credit-exhausted error from the CLI is unconfirmed.
- The subscription is shared by all users of the bot. It is meant for the owner's own accounts; for other people use
  `CLAUDE_AUTH_MODE=api_key`.

## Ideas queued

- Documents: quick actions on a received file, deadlines to reminders, paper scan to searchable PDF, templates,
  a searchable document library.
- Email without OAuth: a personal forwarding address per user (Cloudflare Email Routing) that summarises mail and
  drafts a reply with an "open in mail" (`mailto:`) button; the bot never sends mail on the user's behalf.
- A forwardable invite card (text plus an "Open the bot" button) instead of a bare link.
- Car app: live readouts while recording, chart zoom, a smaller main bundle.
