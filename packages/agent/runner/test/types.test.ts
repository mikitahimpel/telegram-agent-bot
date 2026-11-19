import { it } from "vitest"
import type { ContainerLike, ExecProcessLike } from "../src/container-like.ts"

// Compile-time check: the real Workers Container is assignable to ContainerLike.
it("Container satisfies ContainerLike", () => {
  const _c = (c: Container): ContainerLike => c
  const _p = (p: ExecProcess): ExecProcessLike => p
  void _c
  void _p
})
