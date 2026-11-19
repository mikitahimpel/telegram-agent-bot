export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const escapeAttr = (s: string): string => escapeHtml(s).replace(/"/g, "&quot;")

export const expandableQuote = (html: string): string => `<blockquote expandable>${html}</blockquote>`

const SAFE_URL = /^(https?:\/\/|tg:\/\/|mailto:)/i
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c)
const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c)
const ESCAPABLE = "\\`*_{}[]()#+-.!~>|<"

const findBracketEnd = (s: string, start: number): number => {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === "\\") i++
    else if (c === "[") depth++
    else if (c === "]") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const parseLinkTarget = (s: string, start: number): { url: string; end: number } | undefined => {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === "\\") i++
    else if (c === "(") depth++
    else if (c === ")") {
      depth--
      if (depth === 0) {
        let inner = s.slice(start + 1, i).trim()
        if (inner.startsWith("<") && inner.endsWith(">")) inner = inner.slice(1, -1)
        else {
          const t = /^(\S+)\s+(".*"|'.*')$/.exec(inner)
          if (t !== null) inner = t[1]!
        }
        return { url: inner, end: i + 1 }
      }
    }
  }
  return undefined
}

const findClose = (s: string, from: number, marker: string): number => {
  const ch = marker[0]!
  for (let j = from; j < s.length; j++) {
    const c = s[j]
    if (c === "\\") {
      j++
      continue
    }
    if (c === "`") {
      let n = 0
      while (s[j + n] === "`") n++
      const close = s.indexOf("`".repeat(n), j + n)
      if (close !== -1) j = close + n - 1
      else j += n - 1
      continue
    }
    if (c !== ch) continue
    if (marker.length === 1) {
      if (s[j + 1] === ch) {
        let k = j
        while (s[k] === ch) k++
        j = k - 1
        continue
      }
      if (isSpace(s[j - 1])) continue
      if (ch === "_" && isWordChar(s[j + 1])) continue
      return j
    }
    if (s.startsWith(marker, j) && j > from && !isSpace(s[j - 1])) {
      if (ch === "_" && isWordChar(s[j + marker.length])) continue
      return j
    }
  }
  return -1
}

const renderInline = (s: string): string => {
  let out = ""
  let i = 0
  const n = s.length
  while (i < n) {
    const c = s[i]!
    if (c === "\\" && i + 1 < n && ESCAPABLE.includes(s[i + 1]!)) {
      out += escapeHtml(s[i + 1]!)
      i += 2
      continue
    }
    if (c === "`") {
      let run = 0
      while (s[i + run] === "`") run++
      const fence = "`".repeat(run)
      let close = -1
      for (let j = i + run; j < n; j++) {
        if (s[j] === "`") {
          let m = 0
          while (s[j + m] === "`") m++
          if (m === run) {
            close = j
            break
          }
          j += m - 1
        }
      }
      if (close !== -1) {
        let code = s.slice(i + run, close)
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "")
          code = code.slice(1, -1)
        out += `<code>${escapeHtml(code)}</code>`
        i = close + run
      } else {
        out += fence
        i += run
      }
      continue
    }
    if (c === "[") {
      const end = findBracketEnd(s, i)
      if (end !== -1 && s[end + 1] === "(") {
        const target = parseLinkTarget(s, end + 1)
        if (target !== undefined) {
          const label = renderInline(s.slice(i + 1, end))
          out += SAFE_URL.test(target.url) ? `<a href="${escapeAttr(target.url)}">${label}</a>` : label
          i = target.end
          continue
        }
      }
      out += "["
      i++
      continue
    }
    if (c === "*" || c === "_" || c === "~") {
      const double = s[i + 1] === c
      const marker = c === "~" ? (double ? "~~" : "") : double ? c + c : c
      if (marker !== "") {
        const after = s[i + marker.length]
        const before = s[i - 1]
        const openOk = !isSpace(after) && !(c === "_" && isWordChar(before))
        if (openOk) {
          const close = findClose(s, i + marker.length, marker)
          if (close !== -1 && close > i + marker.length) {
            const inner = renderInline(s.slice(i + marker.length, close))
            const tag = c === "~" ? "s" : marker.length === 2 ? "b" : "i"
            out += `<${tag}>${inner}</${tag}>`
            i = close + marker.length
            continue
          }
        }
        out += marker
        i += marker.length
        continue
      }
    }
    out += c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c
    i++
  }
  return out
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const BULLETS = ["•", "◦", "▪"]

const splitRow = (line: string): string[] => {
  let t = line.trim()
  if (t.startsWith("|")) t = t.slice(1)
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1)
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"))
}

const stripInlineMarks = (s: string): string => s.replace(/\*\*|__|~~|`/g, "")

const width = (s: string): number => [...s].length

const renderTableText = (headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string => {
  const cols = Math.max(headers.length, ...rows.map((r) => r.length))
  const all = [headers, ...rows].map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""))
  const widths = Array.from({ length: cols }, (_, i) => Math.max(1, ...all.map((r) => width(r[i]!))))
  const fmt = (r: ReadonlyArray<string>) =>
    r
      .map((c, i) => c + " ".repeat(widths[i]! - width(c)))
      .join(" | ")
      .trimEnd()
  const lines = all.map(fmt)
  lines.splice(1, 0, widths.map((w) => "-".repeat(w)).join("-+-"))
  return lines.join("\n")
}

const renderBlocks = (lines: ReadonlyArray<string>, inQuote: boolean): string => {
  const blocks: string[] = []
  let i = 0
  let para: string[] = []
  const flushPara = () => {
    if (para.length > 0) {
      blocks.push(para.map((l) => renderInline(l.trim())).join("\n"))
      para = []
    }
  }
  while (i < lines.length) {
    const line = lines[i]!
    const fence = FENCE.exec(line)
    if (fence !== null) {
      flushPara()
      const mark = fence[1]!
      const lang = fence[2]!
      const body: string[] = []
      i++
      while (i < lines.length) {
        const l = lines[i]!
        if (new RegExp(`^\\s{0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`).test(l)) break
        body.push(l)
        i++
      }
      i++
      const code = escapeHtml(body.join("\n"))
      const safeLang = lang.replace(/[^A-Za-z0-9_+#.-]/g, "")
      blocks.push(
        safeLang === "" ? `<pre>${code}</pre>` : `<pre><code class="language-${safeLang}">${code}</code></pre>`
      )
      continue
    }
    if (line.trim() === "") {
      flushPara()
      i++
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      flushPara()
      const text = renderInline(heading[1]!)
      blocks.push(text === "" ? "" : `<b>${text}</b>`)
      i++
      continue
    }
    if (HR.test(line) && !LIST.test(line)) {
      flushPara()
      blocks.push("──────────")
      i++
      continue
    }
    if (QUOTE.test(line)) {
      flushPara()
      const inner: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        inner.push(QUOTE.exec(lines[i]!)![1]!)
        i++
      }
      const body = renderBlocks(inner, true)
      blocks.push(inQuote ? body : `<blockquote>${body}</blockquote>`)
      continue
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes("-")) {
      flushPara()
      const headers = splitRow(line).map(stripInlineMarks)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim() !== "" && lines[i]!.includes("|")) {
        rows.push(splitRow(lines[i]!).map(stripInlineMarks))
        i++
      }
      blocks.push(`<pre>${escapeHtml(renderTableText(headers, rows))}</pre>`)
      continue
    }
    const list = LIST.exec(line)
    if (list !== null) {
      flushPara()
      const items: string[] = []
      while (i < lines.length) {
        const m = LIST.exec(lines[i]!)
        if (m === null || HR.test(lines[i]!)) break
        const depth = Math.min(Math.floor(m[1]!.replace(/\t/g, "    ").length / 2), 6)
        const marker = /^\d/.test(m[2]!) ? m[2]! : BULLETS[Math.min(depth, 2)]!
        let content = m[3]!
        const task = /^\[([ xX])\]\s+(.*)$/.exec(content)
        let prefix = marker
        if (task !== null) {
          prefix = task[1] === " " ? "☐" : "☑"
          content = task[2]!
        }
        items.push(`${"  ".repeat(depth)}${prefix} ${renderInline(content)}`)
        i++
      }
      blocks.push(items.join("\n"))
      continue
    }
    para.push(line)
    i++
  }
  flushPara()
  return blocks.filter((b) => b !== "").join("\n\n")
}

export const markdownToTelegramHtml = (md: string): string =>
  renderBlocks(md.replace(/\r\n?/g, "\n").split("\n"), false)

type Atom =
  | { readonly kind: "open"; readonly name: string; readonly raw: string }
  | { readonly kind: "close"; readonly name: string }
  | { readonly kind: "text"; readonly s: string; readonly len: number }

const tokenize = (html: string): Atom[] => {
  const atoms: Atom[] = []
  const re = /<(\/)?([a-zA-Z][\w-]*)[^>]*>|&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/gy
  let pos = 0
  const pushText = (t: string) => {
    for (const ch of t) atoms.push({ kind: "text", s: ch, len: ch.length })
  }
  while (pos < html.length) {
    const lt = html.slice(pos).search(/[<&]/)
    if (lt === -1) {
      pushText(html.slice(pos))
      break
    }
    if (lt > 0) {
      pushText(html.slice(pos, pos + lt))
      pos += lt
    }
    re.lastIndex = pos
    const m = re.exec(html)
    if (m === null) {
      pushText(html[pos]!)
      pos++
    } else {
      if (m[2] !== undefined) {
        atoms.push(m[1] === "/" ? { kind: "close", name: m[2] } : { kind: "open", name: m[2], raw: m[0] })
      } else {
        atoms.push({ kind: "text", s: m[0], len: 1 })
      }
      pos = re.lastIndex
    }
  }
  return atoms
}

type Open = Extract<Atom, { kind: "open" }>

const applyStack = (stack: Open[], a: Atom): void => {
  if (a.kind === "open") stack.push(a)
  else if (a.kind === "close") {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k]!.name === a.name) {
        stack.length = k
        break
      }
    }
  }
}

const isNl = (a: Atom | undefined): boolean => a !== undefined && a.kind === "text" && a.s === "\n"

export const splitHtml = (html: string, limit = 4096): string[] => {
  if (limit < 1) throw new RangeError("limit must be >= 1")
  const atoms = tokenize(html)
  const visible = (xs: ReadonlyArray<Atom>) => xs.reduce((n, a) => n + (a.kind === "text" ? a.len : 0), 0)
  if (visible(atoms) <= limit) return [html]

  const chunks: string[] = []
  let initial: Open[] = []
  let cur: Atom[] = []
  let vis = 0

  const render = (startStack: ReadonlyArray<Open>, body: ReadonlyArray<Atom>): { html: string; end: Open[] } => {
    const stack = [...startStack]
    let s = startStack.map((o) => o.raw).join("")
    let seenText = false
    let first = 0
    let last = body.length
    while (first < last && (isNl(body[first]) || body[first]!.kind !== "text")) {
      if (isNl(body[first])) first++
      else break
    }
    while (last > first && isNl(body[last - 1])) last--
    for (let k = 0; k < body.length; k++) {
      const a = body[k]!
      applyStack(stack, a)
      if (k < first || k >= last) continue
      if (a.kind === "text") {
        seenText = true
        s += a.s
      } else s += a.kind === "open" ? a.raw : `</${a.name}>`
    }
    const closing = [...stack]
      .reverse()
      .map((o) => `</${o.name}>`)
      .join("")
    return { html: seenText && s.replace(/<[^>]*>/g, "").trim() !== "" ? s + closing : "", end: stack }
  }

  const emit = (body: ReadonlyArray<Atom>): Open[] => {
    const r = render(initial, body)
    if (r.html !== "") chunks.push(r.html)
    return r.end
  }

  const findBreak = (): { cut: number; resume: number } => {
    const minPara = Math.floor(limit / 2)
    const minLine = Math.floor(limit / 4)
    let v = vis
    let para = -1
    let line = -1
    let word = -1
    for (let k = cur.length - 1; k >= 0; k--) {
      const a = cur[k]!
      if (a.kind === "text") v -= a.len
      if (a.kind !== "text") continue
      if (a.s === "\n" && v > 0) {
        if (para === -1 && isNl(cur[k - 1]) && v >= minPara + 0) para = k - 1
        if (line === -1 && v >= minLine) line = k
        if (para !== -1 && line !== -1) break
      } else if (a.s === " " && word === -1 && v > 0) word = k
    }
    if (para !== -1) {
      let r = para
      while (isNl(cur[r])) r++
      return { cut: para, resume: r }
    }
    if (line !== -1) return { cut: line, resume: line + 1 }
    if (word !== -1) return { cut: word, resume: word + 1 }
    return { cut: cur.length, resume: cur.length }
  }

  for (const a of atoms) {
    if (a.kind === "text" && (a.s === "\n" || a.s === " ") && vis + 1 > limit) {
      initial = emit(cur)
      cur = []
      vis = 0
      continue
    }
    if (a.kind === "text" && vis + a.len > limit) {
      const { cut, resume } = findBreak()
      const stackAtCut = [...initial]
      for (const x of cur.slice(0, resume)) applyStack(stackAtCut, x)
      const body = cur.slice(0, cut)
      const rest = cur.slice(resume)
      emit(body)
      const stackAfterResume = [...initial]
      for (const x of cur.slice(0, resume)) applyStack(stackAfterResume, x)
      initial = stackAfterResume
      cur = rest
      vis = visible(cur)
    }
    cur.push(a)
    if (a.kind === "text") vis += a.len
  }
  emit(cur)
  return chunks
}

export type TableHtml = {
  readonly rich: string
  readonly pre: string
}

export const table = (headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): TableHtml => {
  const head = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")
  return {
    rich: `<table>${head}${body}</table>`,
    pre: `<pre>${escapeHtml(renderTableText(headers, rows))}</pre>`
  }
}
