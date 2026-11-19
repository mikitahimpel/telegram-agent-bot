import { Stream } from "effect"

/**
 * Bytes -> lines. UTF-8 sequences and lines split across chunk boundaries are
 * reassembled; a trailing line without "\n" is flushed at end of stream; "\r\n" is accepted.
 */
export const splitLines = <E, R>(bytes: Stream.Stream<Uint8Array, E, R>): Stream.Stream<string, E, R> =>
  bytes.pipe(Stream.decodeText(), Stream.splitLines)
