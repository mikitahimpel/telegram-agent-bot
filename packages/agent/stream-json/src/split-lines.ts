import { Stream } from "effect"

export const splitLines = <E, R>(bytes: Stream.Stream<Uint8Array, E, R>): Stream.Stream<string, E, R> =>
  bytes.pipe(Stream.decodeText(), Stream.splitLines)
