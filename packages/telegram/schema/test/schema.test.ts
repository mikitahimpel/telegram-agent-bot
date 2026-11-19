import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { parseCommand } from "../src/command.ts"
import { decodeUpdate } from "../src/schema.ts"

const base = {
  update_id: 1,
  message: {
    message_id: 5,
    date: 1,
    chat: { id: 10, type: "private", first_name: "A", unknown_chat_field: 1 },
    from: { id: 10, is_bot: false, first_name: "A", is_premium: true },
    text: "/start@mybot hello world",
    entities: [{ type: "bot_command", offset: 0, length: 12 }],
    some_new_field: { x: 1 }
  }
}

describe("decodeUpdate", () => {
  it("tolerates unknown fields", async () => {
    const u = await Effect.runPromise(decodeUpdate(base))
    expect(u.message?.text).toBe("/start@mybot hello world")
    expect("some_new_field" in (u.message as object)).toBe(false)
  })
  it("decodes callback_query, stopped_message_generation, topics", async () => {
    const cb = await Effect.runPromise(
      decodeUpdate({
        update_id: 2,
        callback_query: { id: "c", chat_instance: "x", from: { id: 1, is_bot: false, first_name: "A" }, data: "d" }
      })
    )
    expect(cb.callback_query?.data).toBe("d")
    const st = await Effect.runPromise(
      decodeUpdate({ update_id: 3, stopped_message_generation: { chat: { id: 1, type: "private" }, draft_id: 7 } })
    )
    expect(st.stopped_message_generation?.draft_id).toBe(7)
    const t = await Effect.runPromise(
      decodeUpdate({
        update_id: 4,
        message: {
          message_id: 1, date: 1, chat: { id: 1, type: "private" }, message_thread_id: 9, is_topic_message: true,
          forum_topic_created: { name: "n", icon_color: 1 },
          reply_to_message: { message_id: 0, date: 1, chat: { id: 1, type: "private" }, reply_to_message: { message_id: 1 } }
        }
      })
    )
    expect(t.message?.forum_topic_created?.name).toBe("n")
    expect(t.message?.reply_to_message?.message_id).toBe(0)
  })
  it("fails on invalid input", async () => {
    const r = await Effect.runPromise(Effect.result(decodeUpdate({ update_id: "x" })))
    expect(r._tag).toBe("Failure")
  })
})

describe("parseCommand", () => {
  it("parses entity command with bot suffix", async () => {
    const u = await Effect.runPromise(decodeUpdate(base))
    expect(parseCommand(u.message!)).toEqual({ name: "start", args: "hello world" })
  })
  it("filters other bots", () => {
    expect(parseCommand({ text: "/x@other a" }, "mybot")).toBeUndefined()
    expect(parseCommand({ text: "/x@MyBot a" }, "mybot")).toEqual({ name: "x", args: "a" })
  })
  it("works without entities and rejects plain text", () => {
    expect(parseCommand({ text: "/New" })).toEqual({ name: "new", args: "" })
    expect(parseCommand({ text: "hello /new" })).toBeUndefined()
    expect(parseCommand({})).toBeUndefined()
    expect(parseCommand({ text: "/" })).toBeUndefined()
  })
  it("handles multiline args", () => {
    expect(parseCommand({ text: "/ask\nline1\nline2" })).toEqual({ name: "ask", args: "line1\nline2" })
  })
})

describe("media messages", () => {
  const msg = (extra: Record<string, unknown>) => ({
    update_id: 9,
    message: { message_id: 1, date: 1, chat: { id: 1, type: "private" }, from: { id: 1, is_bot: false, first_name: "A" }, ...extra }
  })
  it("decodes voice, audio, video_note", async () => {
    const u = await Effect.runPromise(
      decodeUpdate(
        msg({
          voice: { file_id: "v", file_unique_id: "u", duration: 3, mime_type: "audio/ogg", file_size: 100 },
          audio: { file_id: "a", file_unique_id: "u2", duration: 5, file_name: "s.mp3" },
          video_note: { file_id: "n", file_unique_id: "u3", length: 240, duration: 4 }
        })
      )
    )
    expect(u.message?.voice?.file_size).toBe(100)
    expect(u.message?.audio?.file_name).toBe("s.mp3")
    expect(u.message?.video_note?.length).toBe(240)
  })
  it("decodes photo sizes, documents and media_group_id", async () => {
    const u = await Effect.runPromise(
      decodeUpdate(
        msg({
          photo: [
            { file_id: "s", file_unique_id: "s1", width: 90, height: 60, file_size: 10 },
            { file_id: "l", file_unique_id: "l1", width: 800, height: 600 }
          ],
          document: { file_id: "d", file_unique_id: "d1", file_name: "a.pdf", mime_type: "application/pdf" },
          media_group_id: "g1",
          caption: "look"
        })
      )
    )
    expect(u.message?.photo?.length).toBe(2)
    expect(u.message?.document?.mime_type).toBe("application/pdf")
    expect(u.message?.media_group_id).toBe("g1")
  })
})
