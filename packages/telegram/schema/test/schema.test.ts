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
