import { it } from "vite-plus/test"
import type { ContainerLike, ExecProcessLike } from "../src/container-like.ts"

it("Container satisfies ContainerLike", () => {
  const _c = (c: Container): ContainerLike => c
  const _p = (p: ExecProcess): ExecProcessLike => p
  void _c
  void _p
})
