export type ModelTier = "fast" | "deep"

const LONG_PROMPT = 500

const DEEP_HINT = new RegExp(
  [
    "машин",
    "авто(?:мобил|м|$|\\b)",
    "двигател",
    "check engine",
    "аккумулятор",
    "расход",
    "поездк",
    "график",
    "диаграмм",
    "таблиц",
    "excel",
    "xlsx",
    "pdf",
    "документ",
    "отч[её]т",
    "анализ",
    "проанализир",
    "посчита",
    "сравни",
    "разбер[иё]",
    "код\\b",
    "скрипт",
    "программ",
    "договор",
    "юридич",
    "медицин",
    "диагноз",
    "\\bcar\\b",
    "engine",
    "battery",
    "\\bfuel\\b",
    "\\btrips?\\b",
    "chart",
    "graph",
    "spreadsheet",
    "\\btable\\b",
    "document",
    "report",
    "analy[sz]",
    "calculat",
    "compare",
    "\\bcode\\b",
    "script",
    "contract",
    "legal",
    "medical"
  ].join("|"),
  "i"
)

export const pickTier = (prompt: string, attachments: number): ModelTier =>
  attachments > 0 || prompt.length > LONG_PROMPT || DEEP_HINT.test(prompt) ? "deep" : "fast"
