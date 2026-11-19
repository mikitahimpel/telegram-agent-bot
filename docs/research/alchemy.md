# Alchemy v2 (Infrastructure-as-Effects) reference

Version researched: `alchemy@2.0.0-beta.87` + `@alchemy.run/cloudflare@2.0.0-beta.87`, `effect@4.1.4`.
Sources: https://v2.alchemy.run/llms.txt (pages are fetchable as `https://alchemy.run/<path>.md`), the installed
packages' `src/` and `lib/*.d.ts`. Snippets marked (tsc) were type-checked against the installed packages
in `/private/tmp/claude-501/alchemy-research`.

Key mental-model differences from v1 and from wrangler:

- Cloudflare resources live in a SEPARATE package: `@alchemy.run/cloudflare` (import `* as Cloudflare`).
- A Worker is an Effect program: construction phase (outer `Effect.gen`) binds resources and reads Config;
  runtime phase (inner handlers) serves requests.
- Provider lifecycle is `reconcile` + `delete` (no separate create/update).
- There is NO `alchemy.secret(...)`. Secrets are `effect/Config` (`Config.Redacted`) values.

## 1. Setup, stack, stages, CLI

Requirements: Node 24.11.1+ or Bun, Cloudflare account.

```sh
bun add alchemy@2.0.0-beta.87 @alchemy.run/cloudflare@2.0.0-beta.87 effect@4.1.4 \
        @effect/platform-bun@4.1.4 @effect/platform-node@4.1.4
```

Peer deps: `effect ^4.1.4`; `@effect/platform-bun`/`@effect/platform-node` `^4.1.4` (optional, install the one
for your runtime; docs install both); `@alchemy.run/cloudflare` peers `alchemy` at the exact same version
(pin both to the same beta). Optional: `vite`, `@alchemy.run/frontend-frameworks`, `ws`.

`alchemy.run.ts` (tsc):

```ts
import * as Alchemy from "alchemy"
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Telegram from "./src/TelegramWebhook.ts" // custom provider (section 5)
import Worker from "./src/worker.ts"

export default Alchemy.Stack(
  "TelegramAgentBot",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Telegram.providers()),
    state: Cloudflare.state() // remote state in a DO-backed Worker (see section 8)
    // secrets: Alchemy.Secrets.DotEnv()  // optional, see section 6
  },
  Effect.gen(function* () {
    const stack = yield* Alchemy.Stack // stack.stage, stack.name
    const worker = yield* Worker
    return { url: worker.url, stage: stack.stage }
  })
)
```

Auth: `alchemy profile edit --add Cloudflare` (OAuth or API token, stored in `~/.alchemy/profiles.json`).
In CI (`CI=true`) it reads `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` from env.

Stages: isolated instances of a stack, own state and physical names (`<app>-<stage>-<id>-<hash>`).
Resolution: `--stage` flag > `$ALCHEMY_STAGE` > `live_$USER` (deploy/destroy/plan) or `dev_$USER` (`alchemy dev`).
Stage names match `[a-z0-9][-_a-z0-9]*`. Convention: `prod`, `staging`, `pr-<n>`.

```sh
bunx alchemy deploy --stage prod --yes     # --yes skips approval; also --dry-run, --detailed, --force, --adopt
bunx alchemy plan   --stage prod
bunx alchemy destroy --stage pr-42 --yes
bunx alchemy dev                           # local workerd, hot reload (stage dev_$USER)
bunx alchemy logs                          # tail logs
bunx alchemy state list --backend cloudflare
```

Other flags: `--config/-c <file>`, `--profile <name>` (or `$ALCHEMY_PROFILE`), `--env-file <path>`
(refused when the stack declares `secrets`).

Branch on stage inside the stack: `const stack = yield* Alchemy.Stack; stack.stage === "prod"`.
Stage-based retention: `.pipe(RemovalPolicy.retain(stack.stage === "prod"))` (`import * as RemovalPolicy from "alchemy/RemovalPolicy"`; from docs).

## 2. Cloudflare Worker (Effect style)

Worker file; default export is the Worker. Resources declared at module scope (tsc):

```ts
// src/worker.ts
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import Agent from "./agent.ts" // a Durable Object class (section 3)

export const Files = Cloudflare.R2.Bucket("Files")
export const Cache = Cloudflare.KV.Namespace("Cache")

export default Cloudflare.Worker(
  "Bot",
  {
    main: import.meta.url, // bundles this file (rolldown)
    compatibility: { flags: ["nodejs_compat"], date: "2026-08-31" },
    observability: {
      // Workers Logs are ON by default; tune here
      logs: { enabled: true, invocationLogs: true, persist: true }
    }
    // domain: "bot.example.com", workersDev: true, assets: "./public", crons, limits, placement, tags ...
  },
  Effect.gen(function* () {
    // ---- Construction phase: bind everything here ----
    const token = yield* Config.Redacted("TELEGRAM_BOT_TOKEN") // auto-bound as secret_text
    const agents = yield* Agent // DO namespace binding
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(Files)
    const kv = yield* Cloudflare.KV.ReadWriteNamespace(Cache)
    const presignPut = yield* Cloudflare.R2.PresignPutObject(Files)

    return {
      // ---- Runtime phase ----
      fetch: Effect.gen(function* () {
        const req = yield* HttpServerRequest
        const n = yield* agents.getByName("chat-123").inc() // typed DO RPC
        const url = yield* presignPut({ key: "a.txt", expiresIn: 300 })
        return HttpServerResponse.text(`${n} ${url}`)
      }).pipe(Effect.orDie)
    }
  }).pipe(
    // Layers decide how each binding is implemented (native bindings here)
    Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
    Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding),
    Effect.provide(Cloudflare.R2.PresignPutObjectToken)
  )
)
```

Typed access to bindings:

- Effect Workers: `yield*` the resource/binding service in the construction phase; the client is typed and its
  errors (`R2Error`, `NamespaceError`) live in the Effect error channel. Access levels:
  `ReadBucket | WriteBucket | ReadWriteBucket` (+ `...Binding` layer); same for KV
  (`ReadNamespace | WriteNamespace | ReadWriteNamespace`).
- Async (non-Effect) Workers: declare `env: { ... }` and derive the type with `InferEnv`:

```ts
// alchemy.run.ts
export const Worker = Cloudflare.Worker("Worker", {
  main: "./src/worker.ts",
  env: { Files, Cache, API_KEY: Config.Redacted("API_KEY"), HOST: Config.String("HOST") }
})
export type WorkerEnv = Cloudflare.InferEnv<typeof Worker> // R2Bucket, KVNamespace, string, ...
// src/worker.ts: export default { async fetch(req: Request, env: WorkerEnv) { ... } }
```

Misc (from docs): `Cloudflare.Worker.URL` (yield in construction, gives the Worker's own public URL),
`Cloudflare.waitUntil(effect)`, `worker.url` / `worker.urls`, RPC between Workers via
`Cloudflare.Worker<Self, Shape>()("Name")` + `.make(...)` + `Cloudflare.Workers.bindWorker(Class)`.
Workers Logs/traces: `Cloudflare.Telemetry()` layer turns on tracing (exported from `Workers/Telemetry.ts`; needs
compat date >= 2026-07-28 for traces). Plain env vars: async Worker `env: { FOO: "bar" }` (strings);
anything from `Config` is always bound as a secret.

## 3. Durable Objects (SQLite) and migrations

SQLite is the default storage (`storage?: "sqlite" | "legacy-kv"`, default `"sqlite"`). Alchemy ships the
declarative `exports` metadata (same as wrangler >= 4.107); there is NO hand-written `migrations` array.
Class rename: `renamedFrom` / `className` option; cross-worker move: `transferredFrom`.

```ts
// src/agent.ts (tsc)
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Effect from "effect/Effect"

export default class Agent extends Cloudflare.DurableObject<Agent>()(
  "Agent",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState // storage, setAlarm, acceptWebSocket ...
    // SQL schema migrations (drizzle-style folder), applied on each object's activation:
    // const migrations = yield* Cloudflare.SqlMigrations("./drizzle");
    return Effect.gen(function* () {
      // yield* migrations.apply().pipe(Effect.orDie);
      let n = (yield* state.storage.get<number>("n")) ?? 0
      return {
        // every Effect-returning member = typed RPC
        inc: () =>
          Effect.gen(function* () {
            n++
            yield* state.storage.put("n", n)
            return n
          })
      }
    })
  })
) {}
```

`yield* Agent` in the Worker construction registers binding + class and returns a namespace;
`agents.getByName("x")` gives the typed stub. Durable callbacks (`Alchemy.makeCallback`) persist jobs in SQLite
and use native alarms. Busy DOs keep old code up to 5 min after a deploy (`codeUpdateStrategy`).

Async-worker form: `env: { Agent: Cloudflare.DurableObject("Agent") }` (class exported from the worker script).

## 4. Containers / Cloudflare Sandbox

Alchemy builds the image itself from a Dockerfile and pushes it to `registry.cloudflare.com` (needs Docker locally
or in CI; linux/amd64). Three image sources on `Cloudflare.Container`: `main` (Effect program bundled into a
generated image), `context` (+ optional `dockerfile`), `image` (pre-built remote image, pulled and re-pushed).

Cloudflare Sandbox SDK (`@cloudflare/sandbox`) is plain JS, so it uses the documented ASYNC-worker path
("Bind on an async Worker"): the container-backed DO class is exported from the worker script and the Container is
declared in `env`. Alchemy emits the `durable_object_namespace` binding, marks the class container-backed, creates
the container application. Docs example uses `image: "docker.io/cloudflare/sandbox:0.1.3"`.

```ts
// alchemy.run.ts
export const Worker = Cloudflare.Worker("Worker", {
  main: "./src/worker.ts",
  compatibility: { flags: ["nodejs_compat"] },
  env: {
    Sandbox: Cloudflare.Container<Sandbox>("Sandbox", {
      // type param = class exported by worker.ts
      context: `${import.meta.dirname}/sandbox`, // dir containing Dockerfile (default <context>/Dockerfile)
      // dockerfile: "./Dockerfile",                       // path relative to context, or Dockerfile.inline`...`
      // className: "Sandbox",                             // defaults to the env key
      instanceType: "standard-1", // see list below
      maxInstances: 5, // default 20; instances default 0 (scale from zero)
      // observability, env: {FOO: "x", SECRET: Redacted.make(...)}, ports, rollout, vcpu/memoryMib/disk
      build: { cache: true } // registry layer cache (useful in CI)
      // publish: { repository: "agent-sandbox" },         // share image across stages
    })
  }
})
export type WorkerEnv = Cloudflare.InferEnv<typeof Worker> // env.Sandbox: DurableObjectNamespace<Sandbox>
```

```ts
// src/worker.ts
import { getSandbox } from "@cloudflare/sandbox"
export { Sandbox } from "@cloudflare/sandbox"
import type { Sandbox } from "@cloudflare/sandbox" // type used by alchemy.run.ts
```

```dockerfile
# sandbox/Dockerfile  (match the tag to the @cloudflare/sandbox npm version; pin it)
FROM docker.io/cloudflare/sandbox:0.9.0
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages duckdb
RUN npm install -g @anthropic-ai/claude-code
```

(`FROM`/package choices above are the user's requirement; the tag `0.9.0` is a placeholder, not verified.)
Inline alternative (tsc: `import { Dockerfile } from "@alchemy.run/docker"`, installed transitively by
the cloudflare package): `dockerfile: Dockerfile.inline\`FROM docker.io/cloudflare/sandbox:...\``.
Build-time secrets: `build: { args: {...}, secrets: { NPM_TOKEN: Config.Redacted("NPM_TOKEN") } }`
(`RUN --mount=type=secret,id=NPM_TOKEN`).

Instance types (`ContainerInstanceType`): `"lite" | "dev"(alias of lite) | "basic" | "standard" | "standard-1" |
"standard-2" | "standard-3" | "standard-4"`; default `lite` (1/16 vCPU, 256 MiB, 2 GB). Custom sizing via
`vcpu`, `memory`/`memoryMib`, `disk` (custom needs >= 1 vCPU and 3072 MiB per vCPU).
Per-stage sizing: `instanceType: stack.stage === "prod" ? "standard-1" : "dev"` (use `Effect.gen` props with `yield* Alchemy.Stack`
or `Stack.useSync` at module scope).

Effect-native container (not Sandbox SDK): `Cloudflare.Container<Self, Shape>()("Name")` + `Self.make({ main, instanceType, maxInstances }, impl)`
in a separate `*.runtime.ts` file that must be `Effect.provide`d to the Stack; DO yields it and calls `sandbox.start({ enableInternet: true })`,
`getTcpPort`, `exec`. Not documented as combinable with `@cloudflare/sandbox`. If the bot Worker must be
Effect-native while the Sandbox host is async, put the Sandbox in a second async Worker and call it via a service
binding (`Cloudflare.WorkerEntrypoint<Api>(target, "Api")` in `env`, docs section "Another Worker's named entrypoint"); this combo is untested.

Limits to know: containers are NOT reachable with native workerd bindings from inside the container; use `*Http`
layers (`R2.ReadWriteBucketHttp`, mints scoped API token) or env vars. `schedulingPolicy: "durable_object"` is a
different mode (one image per Container class, per-instance settings via `start()`; `maxInstances`/`instanceType` invalid there).

## 5. Custom resource: TelegramWebhook (tsc)

Pattern: `Resource<Type, Props, Attrs>` type + constructor, a provider `Layer` via `Provider.succeed`, a
`ProviderCollection` + `Provider.collection([...])`, merged into `providers`.
Lifecycle methods: `reconcile` (create AND update, must be idempotent), `delete` (idempotent), `list` (required;
return `[]` if not enumerable). Optional: `diff`, `read`, `observe`, `precreate`, `lookup`, `stables`.
Errors returned from handlers need a `_tag` (use `Data.TaggedError`); plain `Error` does not type-check.
Props may contain `Redacted` and `Input<T>` (so `worker.url` Outputs resolve before `reconcile`); `worker.url`
is `string | undefined`, so the prop type must allow undefined.

```ts
// src/TelegramWebhook.ts
import { Resource } from "alchemy"
import * as Provider from "alchemy/Provider"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"

export interface TelegramWebhookProps {
  botToken: Redacted.Redacted<string>
  secretToken: Redacted.Redacted<string>
  url: string | undefined
  commands?: { command: string; description: string }[]
}
export interface TelegramWebhookAttributes {
  url: string
  commandsHash: string
}
export type TelegramWebhook = Resource<"Telegram.Webhook", TelegramWebhookProps, TelegramWebhookAttributes>
export const TelegramWebhook = Resource<TelegramWebhook>("Telegram.Webhook")

export class TelegramError extends Data.TaggedError("TelegramError")<{ message: string }> {}

const call = (token: Redacted.Redacted<string>, method: string, body: unknown) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`https://api.telegram.org/bot${Redacted.value(token)}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
      const json = (await res.json()) as { ok: boolean; description?: string }
      if (!json.ok) throw new Error(`${method}: ${json.description}`)
    },
    catch: (e) => new TelegramError({ message: String(e) })
  })

export const TelegramWebhookProvider = () =>
  Provider.succeed(
    TelegramWebhook,
    TelegramWebhook.Provider.of({
      reconcile: Effect.fn(function* ({ news }) {
        if (!news.url) return yield* new TelegramError({ message: "worker has no public url" })
        yield* call(news.botToken, "setWebhook", {
          url: news.url,
          secret_token: Redacted.value(news.secretToken),
          allowed_updates: ["message", "callback_query"]
        })
        yield* call(news.botToken, "setMyCommands", { commands: news.commands ?? [] })
        return { url: news.url, commandsHash: JSON.stringify(news.commands ?? []) }
      }),
      delete: Effect.fn(function* ({ olds }) {
        yield* call(olds.botToken, "deleteWebhook", { drop_pending_updates: false }).pipe(Effect.ignore)
      }),
      list: () => Effect.succeed([])
    })
  )

export class Providers extends Provider.ProviderCollection<Providers>()("Telegram") {}
export const providers = () =>
  Layer.effect(Providers, Provider.collection([TelegramWebhook])).pipe(Layer.provide(TelegramWebhookProvider()))
```

Use in the stack (tsc):

```ts
const botToken = yield* Config.Redacted("TELEGRAM_BOT_TOKEN");
const secretToken = yield* Config.Redacted("TELEGRAM_WEBHOOK_SECRET");
yield* Telegram.TelegramWebhook("Webhook", { botToken, secretToken, url: worker.url, commands: [...] });
```

Notes: `reconcile` runs on every apply that changes props (plan skips when props equal). Because the resource is a
dependency of `worker.url`, it runs after the Worker deploys. Add `diff` returning `{ action: "noop" }` /
`"update"` to control planning (guard with `isResolved(news)` from `alchemy/Diff`). Tip: append `/<random-path>` or
rely on `secret_token` header check in the Worker. Test with `@alchemy.run/test` `test.provider`.
The `Redacted` props are persisted in (encrypted by Cloudflare.state) state.

## 6. Secrets and config

- `Config.Redacted("NAME")` (effect/Config), yielded in the CONSTRUCTION phase, is auto-bound to the Worker as
  `secret_text`. Yielding it only inside a handler binds nothing (footgun). Unwrap with `Redacted.value`.
- Async Workers: `env: { API_KEY: Config.Redacted("API_KEY") }`; arrives as a plain string.
- Defaults/combinators apply at runtime again against the bound source value (`Config.withDefault` is never bound).
- Container env secrets: `env: { KEY: Redacted.make(process.env.KEY!) }` (kept out of plan output).
- Source of values: by default process env + `.env` fallback. Opt in to explicit control:
  `secrets: Alchemy.Secrets.DotEnv()` or list `[Doppler.Secrets(...), Alchemy.Secrets.DotEnv(), Alchemy.Secrets.ProcessEnv()]`;
  callback form `secrets: ({ stage }) => ...`. Later entries override earlier; shell is implicit last.
  `.env` values are NOT written to `process.env` (only to Effect ConfigProvider), so read them with `Config`, not `process.env`.
- Compatible with the user's `pp run --env-file .env -- bunx alchemy deploy` workflow (values arrive via process env).
- Don't hardcode; `Config.Redacted` prints `<redacted>` in logs/errors.

## 7. R2 presigned URLs

Alchemy DOES support it, and it creates the credentials for you:

- `Cloudflare.R2.PresignPutObject(bucket)` / `Cloudflare.R2.PresignGetObject(bucket)` return
  `(request) => Effect<string, PresignError, RuntimeContext>`; provide layer `Cloudflare.R2.PresignPutObjectToken`
  / `PresignGetObjectToken` (tsc for Put). Request: `{ key, expiresIn? (default 900s, max 7d), contentType? }`.
- Deployed: the binding mints a bucket-scoped ACCOUNT API TOKEN (`Workers R2 Storage Write`/Read) and derives S3
  credentials from it (access key id = token id, secret = SHA-256 of token value); URL host
  `https://<accountId>.r2.cloudflarestorage.com`. Signing is local SigV4, no network call.
  The deploy credentials therefore need permission to create account API tokens (not verified what minimum scope; docs
  for CI say the admin profile needs `API Tokens > Write`; check on first deploy).
- Raw credentials: `Cloudflare.R2.S3Credentials(bucket, { access: "read" | "write" | "read-write" })`; in an
  Effect Worker `const creds = yield* ...; const { endpoint, bucketName, accessKeyId, secretAccessKey } = yield* creds;`
  (inside a handler); async Workers get a JSON string in `env`.
- Browser uploads need CORS on the bucket: `Cloudflare.R2.Bucket("Files", { cors: [{ allowedMethods: ["PUT"], allowedOrigins: [...], allowedHeaders: ["content-type"] }] })`.
- `alchemy dev` serves a local S3 endpoint at `{worker url}/cdn-cgi/local/r2/s3`; same code works.
- Native R2 binding alone cannot presign.

## 8. CI (GitHub Actions) and state

State stores: `Alchemy.localState()` (`.alchemy/`, gitignore it), `Alchemy.inMemoryState()` (tests),
`Cloudflare.state({ workerName?, accountId?, domain? })` (recommended; Worker + DO SQLite, token and encryption key
in Secrets Store, auto-bootstrapped on first local deploy), `AWS.state()`, `postgresState()` from `@alchemy.run/sql/PostgresState`.
In CI (`CI=true`) a missing Cloudflare store FAILS instead of being created: provision once locally with
`alchemy state bootstrap --profile <profile>` (or `--backend cloudflare`). Beta.85 breaking: `Cloudflare.state` takes `workerName` only.

Workflow (adapted from tutorial part 5; Bun):

```yaml
name: Deploy
on:
  push: { branches: [main] }
  pull_request: { types: [opened, reopened, synchronize, closed] }
concurrency: { group: deploy-$, { { github.ref } }, cancel-in-progress: false }
env:
  STAGE: >-
    ${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.number)
        || (github.ref == 'refs/heads/main' && 'prod' || github.ref_name) }}
jobs:
  deploy:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: docker/setup-buildx-action@v3 # container image build + build.cache
      - run: bun install --frozen-lockfile
      - run: bun alchemy deploy --stage ${{ env.STAGE }} --yes
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_WEBHOOK_SECRET: ${{ secrets.TELEGRAM_WEBHOOK_SECRET }}
          PULL_REQUEST: ${{ github.event.number }}
  cleanup:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: '[ "${{ env.STAGE }}" != "prod" ] && bun alchemy destroy --stage ${{ env.STAGE }} --yes'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_WEBHOOK_SECRET: ${{ secrets.TELEGRAM_WEBHOOK_SECRET }}
```

Notes:

- `destroy` evaluates the stack program, so every `Config` it reads must be set in the cleanup job too.
- Preview PR stages each get their own Worker, DO, R2, KV, Container app and own Telegram webhook. A Telegram bot has
  ONE webhook: a PR stage would override prod's. Use a separate preview bot token (different secrets per stage) or skip
  the TelegramWebhook resource when `stack.stage !== "prod"`.
- CI credentials as code: `Cloudflare.ApiToken.AccountApiToken("CIToken", { accountId, policies: [{ effect: "allow", permissionGroups: ["Workers Scripts Write", "Workers KV Storage Write", "Workers R2 Storage Write", "Account Settings Write", "Secrets Store Write", "Workers Tail Read", ...], resources: { [`com.cloudflare.api.account.${accountId}`]: "*" } }] })`
  in a one-shot `stacks/github.ts` stack pushed to GitHub with `@alchemy.run/github` `GitHub.Secret` (needs an `admin` profile with API-token-write;
  OAuth can't). Container deploys need Containers permissions in that token (group names not verified; start with a Global-key/admin token and narrow later). Presigned URLs mint tokens, so the deploy token needs token-write too (unverified).
- Optional PR comment: `GitHub.Comment` (`@alchemy.run/github`). Worker Previews (`preview: { of: Worker.ref("Api", { stage: "prod" }) }`) are an alternative that isolates DO state per PR
  without a full stack copy.
- Local multi-worktree: one stage per worktree (`--stage`).

## 9. Gotchas / breaking changes (betas 76-87)

- Pre-release: pin exact versions, bump `alchemy` and `@alchemy.run/cloudflare` together. Breaking changes land in nearly every beta.
- beta.86: regenerated distilled Cloudflare spec (type/prop shape changes across Cloudflare resources).
- beta.85: `Cloudflare.state` takes `workerName` only; DO jurisdiction change for Domain platform/workflow engine.
- beta.84: provider split into packages (git, acme, drizzle, sqlite, axiom, doppler, infisical, github, docker, sql separate); providers contribute auth/state/CLI via Contributions.
- beta.83: one DO Container = one image. beta.82: DO-managed containers, containers must be started explicitly (`sandbox.start(...)`); `InstanceId` service replaced by `ResourceContext`.
- beta.77: profiles and CLI overhaul; default stage is `live_$USER`; env var is `ALCHEMY_STAGE` (not `STAGE`).
- Once a Worker deployed with the declarative `exports` flow it cannot return to old `migrations`; older alchemy releases can't deploy it.
- Constructor `Effect.gen` runs once per isolate; no finalizer runs there. Don't `yield* Config` only in handlers.
- Bundler is rolldown; Effect-native Workers/Containers need `main: import.meta.url` and the file's DEFAULT export to be the program.
- Container runtime file (`*.runtime.ts`) must be imported/provided from `alchemy.run.ts`.
- Container `image` is pulled as linux/amd64 each deploy; pin base-image tags (changes outside the build context do not bust the cache). Local Docker required for Dockerfile builds.
- `compatibility.flags: ["nodejs_compat"]` must be set explicitly.
- First deploy with `Cloudflare.state()` and with containers takes minutes longer (state Worker, registry provisioning).
- Secret `.env` values are not in `process.env` under the `secrets` option; use `Config`.
- Verified NOT present: `alchemy.secret`, `Alchemy.secret`. Not verified: exact Cloudflare API token permission groups for Containers/Sandbox and `@cloudflare/sandbox` version-to-image-tag pairing (check Cloudflare Sandbox docs).
