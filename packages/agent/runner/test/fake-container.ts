import type { ContainerExecOptionsLike, ContainerLike, DirectoryBackupLike, DirectoryBackupRecord, ExecProcessLike, R2Like } from "../src/container-like.ts"

const enc = new TextEncoder()

export type ExecCall = {
  readonly cmd: string[]
  readonly opts: ContainerExecOptionsLike | undefined
}

export type FakeOptions = {
  readonly claudeLines: ReadonlyArray<string>
  readonly hang?: boolean
  readonly claudeExitCode?: number
  readonly claudeStderr?: string
  readonly startRunning?: boolean
  readonly findOutputs?: ReadonlyArray<string>
  readonly failBackup?: boolean
}

export const makeFake = (o: FakeOptions) => {
  const execs: ExecCall[] = []
  const events: string[] = []
  const killed: Array<number | undefined> = []
  let aborted = false
  let running = o.startRunning ?? false
  let findIdx = 0

  const done = (stdout = "", code = 0): ExecProcessLike => ({
    stdout: null,
    stderr: null,
    exitCode: Promise.resolve(code),
    output: async () => ({ stdout: enc.encode(stdout).buffer as ArrayBuffer, stderr: new ArrayBuffer(0), exitCode: code }),
    kill: () => {}
  })

  const claudeProc = (opts: ContainerExecOptionsLike | undefined): ExecProcessLike => {
    let ctl!: ReadableStreamDefaultController<Uint8Array>
    let resolveExit!: (n: number) => void
    const exitCode = new Promise<number>((r) => (resolveExit = r))
    let closed = false
    const close = (code: number) => {
      if (closed) return
      closed = true
      try { ctl.close() } catch {}
      resolveExit(code)
    }
    const stdout = new ReadableStream<Uint8Array>({
      start(c) {
        ctl = c
        const lines = o.claudeLines.map((l) => `${l}\n`).join("")
        const bytes = enc.encode(lines)
        const mid = Math.floor(bytes.length / 2)
        c.enqueue(bytes.slice(0, mid))
        c.enqueue(bytes.slice(mid))
        if (o.hang !== true) queueMicrotask(() => close(o.claudeExitCode ?? 0))
      }
    })
    opts?.signal?.addEventListener("abort", () => {
      aborted = true
      close(137)
    })
    return {
      stdout,
      stderr: new Response(o.claudeStderr ?? "").body,
      exitCode,
      output: async () => ({ stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: await exitCode }),
      kill: (sig) => {
        killed.push(sig)
        close(137)
      }
    }
  }

  const container: ContainerLike = {
    get running() { return running },
    images: { workspace: "img:workspace" },
    start: () => { running = true; events.push("start") },
    destroy: async () => { running = false; events.push("destroy") },
    setInactivityTimeout: async (ms) => { events.push(`timeout:${ms}`) },
    exec: async (cmd, opts) => {
      execs.push({ cmd, opts })
      const [bin, a1] = cmd
      if (bin === "claude" && cmd.includes("-p")) return claudeProc(opts)
      if (bin === "claude" && a1 === "--version") return done("2.1.328 (Claude Code)\n")
      if (bin === "claude" && a1 === "auth") return done('{"loggedIn":true}')
      if (bin === "find") return done(o.findOutputs?.[Math.min(findIdx++, o.findOutputs.length - 1)] ?? "")
      if (bin === "cat") return done("file-bytes")
      return done()
    }
  }

  const records = new Map<string, DirectoryBackupRecord>()
  let n = 0
  const backup: DirectoryBackupLike = {
    backup: async ({ dir, name }) => {
      if (o.failBackup === true) throw new Error("r2 down")
      events.push(`backup:${dir}`)
      const rec = { id: `b${++n}`, dir, size: 1, sha256: "x", format: "tar+zstd/1", ...(name === undefined ? {} : { name }) } as DirectoryBackupRecord
      records.set(rec.id, rec)
      return rec
    },
    restore: async (r) => { events.push(`restore:${r.dir}`) },
    delete: async (r) => { events.push(`delete:${r.id}`) }
  }

  const store = new Map<string, string>()
  const bucket: R2Like = {
    get: async (k) => (store.has(k) ? { text: async () => store.get(k)! } : null),
    put: async (k, v) => { store.set(k, v) },
    delete: async (k) => { for (const key of [k].flat()) store.delete(key) }
  }

  return { container, backup, bucket, store, execs, events, killed, wasAborted: () => aborted }
}
