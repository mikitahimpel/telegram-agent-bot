import type { DirectoryBackupOptions, DirectoryBackupRecord, DirectoryRestoreOptions } from "@cloudflare/sandbox"

/** Subset of the Workers `ExecProcess` the runner uses. */
export interface ExecProcessLike {
  readonly stdout: ReadableStream<Uint8Array> | null
  readonly stderr: ReadableStream<Uint8Array> | null
  readonly exitCode: Promise<number>
  output(): Promise<{ readonly stdout: ArrayBuffer; readonly stderr: ArrayBuffer; readonly exitCode: number }>
  kill(signal?: number): void
}

export interface ContainerExecOptionsLike {
  cwd?: string
  env?: Record<string, string>
  /** "uid:gid" */
  user?: string
  signal?: AbortSignal
  stdout?: "pipe" | "ignore"
  stderr?: "pipe" | "ignore" | "combined"
}

export interface ContainerStartOptionsLike {
  image: string
  instance?: "lite" | "basic" | "standard-1" | "standard-2" | "standard-3" | "standard-4"
  enableInternet?: boolean
  env?: Record<string, string>
  labels?: Record<string, string>
}

/**
 * Structural subset of the Workers runtime `Container` (`ctx.container` of a Durable Object),
 * verified against @cloudflare/workers-types. The real object is assignable (see test/types.test.ts).
 */
export interface ContainerLike {
  readonly running: boolean
  /** Image names declared in wrangler/alchemy (`containers[].images`) -> image reference. */
  readonly images: Record<string, string>
  start(options?: ContainerStartOptionsLike): void
  destroy(error?: unknown): Promise<void>
  setInactivityTimeout(durationMs: number): Promise<void>
  exec(cmd: string[], options?: ContainerExecOptionsLike): Promise<ExecProcessLike>
}

/** `new DirectoryBackup(ctx.container, ctx.exports.DirectoryBackupGateway, { binding, prefix: "agents/<tgId>/" })`. */
export interface DirectoryBackupLike {
  backup(options: DirectoryBackupOptions): Promise<DirectoryBackupRecord>
  restore(backup: DirectoryBackupRecord, options?: DirectoryRestoreOptions): Promise<void>
  delete(backup: DirectoryBackupRecord): Promise<void>
}

/** Subset of `R2Bucket` used for the backup index (`agents/<tgId>/backup.json`) and nothing else. */
export interface R2Like {
  get(key: string): Promise<{ text(): Promise<string> } | null>
  put(key: string, value: string): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
}

export type { DirectoryBackupRecord }
