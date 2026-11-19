# Research: Cloudflare Sandbox SDK 1.0.3 + Claude Code headless

Verified against: installed `@cloudflare/sandbox@1.0.3` (`dist/index.d.mts`), `@anthropic-ai/claude-code@2.1.328`
(real binary run, `--help`, binary strings), and Cloudflare / code.claude.com docs (fetched 2026-11-19).
Install dir: `/private/tmp/claude-501/sandbox-research`.

## A. Cloudflare Sandbox SDK 1.0.3

### A0. BIG CHANGE vs 0.x: there is no `getSandbox`, `Sandbox` class, `startProcess`, `execStream`, `parseSSEStream`, `mountBucket`, `sleepAfter`, `keepAlive`, `createBackup`, `onStart/onStop`
The 1.0 package exports ONLY (confirmed from the .d.ts):
`Files`, `S3Mount`, `S3Gateway`, `DirectoryBackup`, `DirectoryBackupGateway`, `SandboxFileError`,
`SandboxProtocolError`, `SandboxS3MountError`, `SandboxBackupError`.
You write your OWN Durable Object and drive the raw Workers Container API on `this.ctx.container`; the package only adds
file ops, S3 mounts and directory backups. Don't use the `sandbox-stable` skill / 0.x docs for this.

### A1. Config
Worker needs `compatibility_flags: ["nodejs_compat"]`. Containers use `scheduling_policy: "durable_object"`.
```jsonc
// wrangler.jsonc
{
  "name": "telegram-agent-bot", "main": "src/index.ts", "compatibility_date": "2026-11-19",
  "compatibility_flags": ["nodejs_compat"],
  "containers": [{
    "class_name": "AgentSandbox",
    "scheduling_policy": "durable_object",
    "images": { "workspace": { "dockerfile": "./Dockerfile" } }
  }],
  "durable_objects": { "bindings": [{ "class_name": "AgentSandbox", "name": "SANDBOX" }] },
  "exports": { "AgentSandbox": { "type": "durable-object", "storage": "sqlite" } },
  "r2_buckets": [{ "binding": "BACKUPS", "bucket_name": "agent-backups" }]
}
```
(`exports` block is the docs' form; classic setups use `migrations: [{tag, new_sqlite_classes}]`. Use whichever your wrangler version accepts.)

Dockerfile (image MUST contain `sandbox-shim`, used by `Files`, `S3Mount`, `DirectoryBackup`; tag should match package version -
docs example shows `1.0.1`; `1.0.3` is assumed to exist, verify with `docker pull docker.io/cloudflare/sandbox:1.0.3`):
```dockerfile
FROM node:24-trixie-slim
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-pip tar zstd \
 && rm -rf /var/lib/apt/lists/*
RUN npm i -g @anthropic-ai/claude-code@2.1.328
# base node image already has non-root user `node` (uid/gid 1000)
RUN mkdir -p /workspace /home/node/.claude && chown -R 1000:1000 /workspace /home/node
CMD ["sleep", "infinity"]
```
Add node/python packages with normal `RUN npm i -g ...` / `pip install ...`. Any image works if it has the shim.

### A2. Instance types (`container.start({instance})`, default `"lite"`; from containers pricing page)
| name | vCPU | mem | disk |
|---|---|---|---|
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |
Custom: `instance: { vcpu, memoryMib, diskMb }`. Claude Code CLI wants >= `basic`; `standard-1` is the safe pick.

### A3. The Durable Object (copy-paste skeleton)
```ts
import { DurableObject } from "cloudflare:workers";
import { Files, DirectoryBackup, DirectoryBackupGateway, type DirectoryBackupRecord } from "@cloudflare/sandbox";
export { DirectoryBackupGateway };               // REQUIRED export from main module; never route HTTP to it

export class AgentSandbox extends DurableObject<Env> {
  #backup: DirectoryBackup;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const c = ctx.container;
    if (!c) throw new Error("container binding missing");
    this.#backup = new DirectoryBackup(c, ctx.exports.DirectoryBackupGateway, { binding: "BACKUPS", prefix: "sandboxes/" });
    if (c.running) void c.setInactivityTimeout(30 * 60_000);   // max 6h (21_600_000 ms); re-set after every restart
  }
  async ensureStarted() {
    const c = this.ctx.container!;
    if (c.running) return;
    c.start({
      image: c.images.workspace,        // name from wrangler `images`
      instance: "standard-1",
      enableInternet: true,             // required whenever options are passed
      env: { /* container-level env, non-secret */ },
      labels: { chat: this.ctx.id.toString() },
    });
    await c.setInactivityTimeout(30 * 60_000);
    this.ctx.waitUntil(c.monitor().catch((e) => console.error("container died", e)));
    // `start()` returns before ready; first exec/Files call may need a retry loop (e.g. `exec(["true"])` x N).
  }
}
```
Worker side: `env.SANDBOX.getByName("chat-123")` -> DO stub -> call your RPC methods. (No `getSandbox`.)

### A4. exec / streaming / kill (raw Container API, confirmed from docs)
`exec(cmd: string[], opts)` -> `ExecProcess`; NO shell (use `["bash","-lc",script]`). Opts: `stdin: ReadableStream|"pipe"`,
`stdout:"pipe"|"ignore"`, `stderr:"pipe"|"ignore"|"combined"`, `cwd`, `env` (NOT inherited from `start()` except PATH -> pass
`HOME`, `PATH` extras here), `user:"uid:gid"`, `signal: AbortSignal` (abort = SIGKILL), `pty`.
Handle: `pid`, `stdout/stderr: ReadableStream`, `stdin: WritableStream`, `exitCode: Promise<number>`, `output()` (buffers all; call once),
`kill(signal=15)`, `resize()`. `kill` signals ONLY the started process (children survive) -> kill the tree via `bash -c 'kill -- -pgid'` or
run under `setsid`/`timeout`. Container-wide: `container.signal(n)`, `container.destroy()`.
Per-exec env = just `env: {...}`; secrets only per exec, never baked in image.

Line-by-line stdout (replaces `execStream`+`parseSSEStream`):
```ts
async function* lines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) { buf += value; let i; while ((i = buf.indexOf("\n")) >= 0) { yield buf.slice(0, i); buf = buf.slice(i + 1); } }
    if (done) { if (buf) yield buf; return; }
  }
}
const ac = new AbortController();
const p = await this.ctx.container!.exec(["claude", "-p", prompt /* ...flags */], {
  cwd: "/workspace", user: "1000:1000", stderr: "ignore", signal: ac.signal,
  env: { HOME: "/home/node", CLAUDE_CODE_OAUTH_TOKEN: token, PATH: "/usr/local/bin:/usr/bin:/bin" },
});
for await (const line of lines(p.stdout!)) { const ev = JSON.parse(line); /* handle */ }
const code = await p.exitCode;
// cancel: p.kill(2) /*SIGINT: ends turn gracefully*/ or ac.abort() /*SIGKILL*/
```
Long jobs: the DO must stay alive while streaming (an open RPC/`waitUntil` + `setInactivityTimeout`). "Background process" =
`exec` and keep the handle; `getProcess/listProcesses` are NOT in the 1.0.3 types. Process IDs die with the container.
Streaming to caller: return `ReadableStream`/`Response` from a DO method and tee events to Telegram edits.

### A5. Files (`Files`, confirmed .d.ts; container must be running)
```ts
const files = new Files(this.ctx.container!);
await files.writeFile("/workspace/a.txt", "hi", { user: "1000:1000" });   // string|ArrayBuffer|Blob|ReadableStream
const text = await (await files.readFile("/workspace/a.txt")).text();      // returns Response
await files.mkdir("/workspace/x", { recursive: true });
await files.readDirectory("/workspace");  // [{name,type}]
await files.stat(p); await files.lstat(p); await files.rename(a, b); await files.remove(p, { recursive: true, force: true });
```
Errors: `SandboxFileError` (Linux code e.g. ENOENT), `SandboxProtocolError`. Files written by root-run shim: pass `user:"1000:1000"` for ownership.

### A6. Persistence to R2 (two options)
**Backup/restore (recommended for ~/.claude + workspace)** - `DirectoryBackup` (tar+zstd, SHA-256 verified, multipart 16 MiB parts, R2 creds never enter container):
```ts
async snapshot() {
  const rec = await this.#backup.backup({ dir: "/home/node/.claude", name: "claude-home", exclude: ["cache/**", "**/node_modules/**"] });
  await this.ctx.storage.put("bk:claude", rec);         // YOU store the record (no list API)
}
async restoreAll() {
  await this.ensureStarted();
  const rec = await this.ctx.storage.get<DirectoryBackupRecord>("bk:claude");
  if (rec) await this.#backup.restore(rec);              // replaces dir; target's parent must exist
}
// delete old: await this.#backup.delete(oldRec)   (no running container needed)
```
Limits: one op at a time per container; restore needs free space for old+new; no timeouts/retries (pass `signal`);
`EXDEV` under `wrangler dev` for image dirs; if DO also calls `interceptAllOutboundHttp()`, call `backup.intercept()` first.
Pause writers (no running `claude`) before backup. Restore into a fresh container (even newer image) works.
Also exists: `container.snapshotContainer()` (whole writable root FS; docs, not in this package's types).

**S3 mount of R2** (`S3Mount`; R2 via its S3 endpoint, needs an R2 API token; FUSE, not POSIX - no locking/atomic rename):
```ts
import { S3Mount, S3Gateway } from "@cloudflare/sandbox"; export { S3Gateway };
const m = new S3Mount(this.ctx.container!, this.ctx.exports.S3Gateway);
await m.mount({ mountPath: "/mnt/data", access: "read-write", keyPrefix: "chat-123/",
  source: { type: "s3", endpoint: `https://${ACCT}.r2.cloudflarestorage.com`, region: "auto", bucket: "agent-data",
            credentials: { type: "static", accessKeyId, secretAccessKey } } });
```
(Credentials stay in the Worker, signed by gateway.) Unmount does not clear the intercept; use a new sandbox name per tenant/job.
Prefer backups for `~/.claude` (session jsonl files are appended often; FUSE append is poor).

### A7. Lifecycle / "hooks"
No `onStart/onStop/sleepAfter/keepAlive`. Equivalents: idle = `container.setInactivityTimeout(ms)` (<= 6h, container runs that long
after the DO goes inactive; re-set each start); `container.monitor()` resolves/rejects AFTER stop (too late to snapshot - filesystem gone).
So: snapshot `~/.claude` (+ workspace) at the end of EVERY turn (after `claude` exits) and restore on cold start. Store records in DO storage.
`running` is a boolean; `inspect()` -> `{image, labels}`.

### A8. Ports & networking
Expose a container port to the Worker: `const f = this.ctx.container!.getTcpPort(8080); await f.fetch("http://container/path")`.
(Public preview-URL helpers `proxyToSandbox` belong to 0.x/next, not in 1.0.3 types.)
Outbound: `enableInternet: true` -> container reaches the public internet (incl. your Worker's public `https://...workers.dev`) directly.
`enableInternet: false` -> only intercepted hosts: `await container.interceptOutboundHttp("my.worker", this.ctx.exports.MyHandler)`,
`interceptOutboundHttps("*.x.com", handler)` (container must trust `/etc/cloudflare/certs/cloudflare-containers-ca.crt`), `interceptAllOutboundHttp(h)` (port 80 only);
<=128 intercepts, last until container stops, re-register at each start; handler = `WorkerEntrypoint` export that can inject credentials.
Cleanest callback for the agent: intercept a fake host `tools.internal` -> WorkerEntrypoint that serves the MCP server, so no token/URL needed in the sandbox.

---

## B. Claude Code CLI 2.1.328 headless

### B1. Command (copy-paste)
```bash
claude -p "$PROMPT" \
  --output-format stream-json --verbose --include-partial-messages \
  --session-id <uuid>            # NEW session with chosen id (must be a valid UUID)
  # or: --resume <session_id>    # continue an existing one (add --fork-session for new id)
  --mcp-config '{"mcpServers":{"bot":{"type":"http","url":"https://bot.example.workers.dev/mcp","headers":{"Authorization":"Bearer ${BOT_MCP_TOKEN}"}}}}' \
  --strict-mcp-config \
  --permission-mode dontAsk --allowedTools "Bash,Read,Edit,Write,mcp__bot" \
  --append-system-prompt "You are ..." \
  --max-turns 30 --max-budget-usd 2 --model sonnet --effort medium
```
Verified in `--help`: `--session-id`, `--resume`, `--fork-session`, `--mcp-config <configs...>`, `--strict-mcp-config`, `--max-budget-usd`,
`--append-system-prompt`, `--include-partial-messages`, `--no-session-persistence`, `--bare`, `--permission-mode`, `--effort`.
`--max-turns` is documented in CLI ref; result `subtype:"error_max_turns"` when hit. `--verbose` is REQUIRED for stream-json with `-p`.
- MCP `type` must be `"http"` (alias `streamable-http`); `url` without `type` is skipped. `${VAR}` expands in url/headers/env;
  names like ANTHROPIC_API_KEY/NPM_TOKEN read as empty - use your own name (`BOT_MCP_TOKEN`). Verified: a dead server shows in init as
  `"mcp_servers":[{"name":"x","status":"failed","source":"dynamic"}]`; bad entries listed in `mcp_server_errors`. Tool names: `mcp__<server>__<tool>`.
- Permissions: since 2.1.302 `-p` starts in Manual mode; unapproved calls are denied (not hung). Choices: `--allowedTools` list,
  `--permission-mode acceptEdits|dontAsk|auto`, `--permission-prompts none` (2.1.259+), or `--dangerously-skip-permissions`.
- Stop: SIGINT ends the turn cleanly; SIGTERM exits 143 with no result event for the turn.
- Claude stays open after final turn while background tasks run (10 min cap, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`); `--bare` disables bg tasks + hooks/CLAUDE.md/OAuth (bare ignores OAuth! needs ANTHROPIC_API_KEY -> don't use --bare with subscription token).

### B2. stream-json events (one JSON per line)
1. `system/init` (first line): `{"type":"system","subtype":"init","cwd","session_id","tools":[..],"mcp_servers":[{name,status}],"model","permissionMode","apiKeySource":"none"|...,"claude_code_version","uuid",...}` (also `mcp_server_errors`, `plugin_errors`). Other `system` subtypes: `status` (`{status:"requesting"}`), `api_retry` (`attempt,max_retries,retry_delay_ms,error_status,error`), `permission_denied`, hook_* .
2. `stream_event` (only with --include-partial-messages): `{"type":"stream_event","event":<Anthropic raw stream event>,"parent_tool_use_id":null,"uuid","session_id"}`;
   text: `event.type=="content_block_delta" && event.delta.type=="text_delta"` -> `event.delta.text`; also `input_json_delta`, `thinking_delta`, `message_start/stop`, `content_block_start/stop`.
   Filter: `jq -rj 'select(.type=="stream_event" and .event.delta.type?=="text_delta")|.event.delta.text'`
3. `assistant`: `{"type":"assistant","message":{id,model,role,stop_reason,usage,content:[{"type":"text","text"}|{"type":"tool_use","id","name","input"}|{type:"thinking"}]},"parent_tool_use_id":null|"toolu_..","session_id","uuid","error"?}`.
   `error` ∈ authentication_failed|oauth_org_not_allowed|account_on_hold|billing_error|rate_limit|overloaded|invalid_request|model_not_found|server_error|max_output_tokens|cloud_credential_error|unknown. Synthetic client errors have `message.model:"<synthetic>"`, `is_api_error_message:true`.
4. `user`: tool results `{"type":"user","message":{role:"user",content:[{"type":"tool_result","tool_use_id","content","is_error"}]},...}`.
5. `rate_limit_event`: `{"type":"rate_limit_event","rate_limit_info":{status:"allowed"|"allowed_warning"|"rejected", resetsAt, rateLimitType, isUsingOverage, utilization...},"uuid","session_id"}` (exact inner fields: binary strings only; parse defensively).
6. `result` (last line), real captured sample (auth failure):
```json
{"type":"result","subtype":"success","is_error":true,"api_error_status":401,"num_turns":1,"result":"Failed to authenticate. API Error: 401 Invalid bearer token",
 "stop_reason":"stop_sequence","terminal_reason":"api_error","session_id":"...","total_cost_usd":0,"duration_ms":2290,"duration_api_ms":0,
 "usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,...},"modelUsage":{},"permission_denials":[],"uuid":"..."}
```
   NOTE `subtype:"success"` can still have `is_error:true` - always check `is_error`. Error subtypes (no `result`, has `errors: string[]`):
   `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`. `terminal_reason` e.g. `max_turns|api_error|budget_exhausted`.
   `total_cost_usd` is a client estimate (and cumulative over resumes).

### B3. Auth and usage-limit detection
- Subscription: run `claude setup-token` once on a machine, put the long-lived token in `CLAUDE_CODE_OAUTH_TOKEN` (per exec `env`). No token -> real captured result:
  `is_error:true, result:"Not logged in · Please run /login", assistant.error:"authentication_failed", api_error_status:null` (init `apiKeySource:"none"`). Bad token -> `api_error_status:401`.
  Need `HOME` set to a writable dir. API-key alternative: `ANTHROPIC_API_KEY`.
- Usage limit (subscription window exhausted): assistant message `error:"rate_limit"` and `result` event with `is_error:true`, `result` text containing
  the limit message (older builds: `Claude AI usage limit reached|<epoch_seconds>`; the 2.1.x client composes "You've hit your limit ... resets <time>"; binary also
  carries `apiError:"usage_limit_reached"` with `rate_limit_info`). I could NOT reproduce this (no exhausted account) -> detect robustly:
  `is_error && (assistant.error=="rate_limit" || api_error_status==429 || /usage limit|hit your limit|limit reached/i.test(result))`, then parse
  `/\|(\d{9,})/` epoch OR `rate_limit_event.rate_limit_info.resetsAt` for the reset time. Watch `rate_limit_event` `allowed_warning` to warn early.
  Transient 429/529 emit `system/api_retry` first.

### B4. Sessions & restore
Transcripts: `$HOME/.claude/projects/<cwd with / and . -> ->/<session_id>.jsonl` (e.g. cwd `/workspace` -> `-workspace`). Auto-memory under same project dir.
`--resume <id>` looks the id up across ALL projects under `~/.claude`, so restoring `~/.claude` (esp. `projects/`) is enough, even if cwd differs
(docs: "finds the session by its ID in any project"); `--resume /abs/path/x.jsonl` also works. Keep the same `/workspace` cwd anyway so file context matches.
Back up `~/.claude` after each turn (exclude caches); don't use `--no-session-persistence`. Capture `session_id` from `system/init`.
First turn: pass your own `--session-id <uuid>` so you can store it before the run starts; later turns `--resume`.
(Cost shown after `--resume` includes earlier runs.)

### B5. Root / non-root
Verified string in binary: `--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons` (exits). Binary also checks
`IS_SANDBOX==="1"` (and docker/bubblewrap detection) as a sandbox signal that lifts that restriction (behavior inferred from code/strings, not tested as root).
Best practice here: run as uid 1000 (`user:"1000:1000"` in exec, `HOME=/home/node`) and prefer `--permission-mode`/`--allowedTools` over
`--dangerously-skip-permissions`; if you must run as root: `IS_SANDBOX=1`.
Local note: `IS_SANDBOX=1` with `--dangerously-skip-permissions` as uid 501 ran fine (no root error).

### B6. Cheap smoke test (no tokens spent)
`HOME=$(mktemp -d) claude -p hi --output-format stream-json --verbose` -> init + "Not logged in" result, exit 0 (!). Exit code is not reliable for errors: parse the `result` event.
