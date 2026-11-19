import { describe, expect, it } from "vitest"
import { escapeHtml, expandableQuote, markdownToTelegramHtml as md, splitHtml, table } from "../src/format.ts"

const visible = (h: string) =>
  h.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot);/g, "x")

const balanced = (h: string): boolean => {
  const st: string[] = []
  for (const m of h.matchAll(/<(\/)?([a-z-]+)[^>]*>/g)) {
    if (m[1]) { if (st.pop() !== m[2]) return false } else st.push(m[2]!)
  }
  return st.length === 0
}

describe("escapeHtml", () => {
  it("escapes", () => expect(escapeHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c"))
})

describe("markdownToTelegramHtml", () => {
  it("inline styles", () => {
    expect(md("**b** *i* _i2_ ~~s~~ `c<`")).toBe("<b>b</b> <i>i</i> <i>i2</i> <s>s</s> <code>c&lt;</code>")
  })
  it("snake_case and math stars stay literal", () => {
    expect(md("snake_case_name and 2 * 3 * 4")).toBe("snake_case_name and 2 * 3 * 4")
  })
  it("nested", () => expect(md("**a *b* c**")).toBe("<b>a <i>b</i> c</b>"))
  it("unclosed markers are literal", () => expect(md("**abc")).toBe("**abc"))
  it("escapes html", () => expect(md("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d"))
  it("fenced code", () => {
    expect(md("```ts\nconst a = 1 < 2\n```")).toBe('<pre><code class="language-ts">const a = 1 &lt; 2</code></pre>')
    expect(md("```\nx\n```")).toBe("<pre>x</pre>")
  })
  it("unclosed fence runs to end", () => expect(md("```py\nx = 1")).toBe('<pre><code class="language-py">x = 1</code></pre>'))
  it("markdown inside code is untouched", () => expect(md("```\n**x**\n```")).toBe("<pre>**x**</pre>"))
  it("links", () => {
    expect(md("[a *b*](https://x.com/?a=1&b=2)")).toBe('<a href="https://x.com/?a=1&amp;b=2">a <i>b</i></a>')
    expect(md("[x](javascript:alert(1))")).toBe("x")
  })
  it("headings", () => expect(md("## Title\ntext")).toBe("<b>Title</b>\n\ntext"))
  it("lists", () => {
    expect(md("- a\n  - b\n1. c\n- [x] d")).toBe("• a\n  ◦ b\n1. c\n• ☑ d".replace("• ☑ d", "☑ d"))
  })
  it("blockquote", () => expect(md("> a\n> b\n\nc")).toBe("<blockquote>a\nb</blockquote>\n\nc"))
  it("table becomes pre", () => {
    const out = md("| a | b |\n|---|---|\n| 1 | 22 |")
    expect(out).toBe("<pre>a | b\n--+---\n1 | 22</pre>")
  })
  it("always balanced", () => {
    const samples = ["**a _b** c_", "*a **b* c**", "[**x](u)**", "`a **b`", "> **x\n> y**", "# **h"]
    for (const s of samples) expect(balanced(md(s))).toBe(true)
  })
})

describe("splitHtml", () => {
  it("returns single chunk when short", () => expect(splitHtml("<b>a</b>", 10)).toEqual(["<b>a</b>"]))
  it("splits on paragraphs", () => {
    const out = splitHtml("aaaa\n\nbbbb\n\ncccc", 10)
    expect(out).toEqual(["aaaa\n\nbbbb", "cccc"])
  })
  it("splits on lines then words then hard", () => {
    expect(splitHtml("aaaa\nbbbb\ncccc", 9)).toEqual(["aaaa\nbbbb", "cccc"])
    expect(splitHtml("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"])
    expect(splitHtml("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"])
  })
  it("closes and reopens tags, including pre", () => {
    const html = '<pre><code class="language-ts">' + Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n") + "</code></pre>"
    const out = splitHtml(html, 20)
    expect(out.length).toBeGreaterThan(1)
    for (const c of out) {
      expect(c.startsWith('<pre><code class="language-ts">')).toBe(true)
      expect(c.endsWith("</code></pre>")).toBe(true)
      expect(balanced(c)).toBe(true)
      expect(visible(c).length).toBeLessThanOrEqual(20)
    }
    expect(out.map((c) => c.replace(/<[^>]*>/g, "")).join("\n")).toBe(Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n"))
  })
  it("never breaks tags or entities", () => {
    const html = "<b>" + "&amp;".repeat(30) + '</b> <a href="https://x.y/?a=1&amp;b=2">' + "z".repeat(30) + "</a>"
    for (const c of splitHtml(html, 7)) {
      expect(balanced(c)).toBe(true)
      expect(c).not.toMatch(/&[a-z]*$/)
      expect(visible(c).length).toBeLessThanOrEqual(7)
    }
  })
  it("keeps href on reopened links", () => {
    const out = splitHtml('<a href="https://e.com">' + "w ".repeat(20) + "</a>", 10)
    for (const c of out) expect(c.startsWith('<a href="https://e.com">')).toBe(true)
  })
  it("respects default limit on large markdown", () => {
    const big = Array.from({ length: 400 }, (_, i) => `**item ${i}** some text <here> & there`).join("\n\n")
    const out = splitHtml(md(big))
    expect(out.length).toBeGreaterThan(1)
    for (const c of out) {
      expect(balanced(c)).toBe(true)
      expect(visible(c).length).toBeLessThanOrEqual(4096)
    }
  })
  it("does not split surrogate pairs", () => {
    for (const c of splitHtml("😀".repeat(10), 4)) expect([...c].every((ch) => ch === "😀")).toBe(true)
  })
})

describe("table / expandableQuote", () => {
  it("builds rich and pre", () => {
    const t = table(["a", "b<"], [["1", "2"]])
    expect(t.rich).toBe("<table><tr><th>a</th><th>b&lt;</th></tr><tr><td>1</td><td>2</td></tr></table>")
    expect(t.pre).toBe("<pre>a | b&lt;\n--+---\n1 | 2</pre>")
  })
  it("expandable", () => expect(expandableQuote("x")).toBe("<blockquote expandable>x</blockquote>"))
})
