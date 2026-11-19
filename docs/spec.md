# Промпт: Telegram-бот — Claude-агент на Cloudflare (Effect + Alchemy)

Ты — senior TypeScript-инженер. Помоги мне спроектировать и реализовать проект с нуля. Сначала изучи актуальную документацию, потом предложи план и согласуй его со мной, только затем пиши код — поэтапно, с работающим результатом после каждого этапа.

## Что строим

Один Telegram-бот, который работает как AI-агент на базе Claude Code (CLI `claude`), запущенного в Cloudflare Sandbox. Каждый Telegram-аккаунт — отдельный независимый агент со своей памятью и сессиями. Бот расширяется плагинами; первый плагин — аналитика данных моей машины (OBD).

## Стек и обязательные источники

- **Alchemy v2** (Infrastructure-as-Effects, бета) — вся инфраструктура в `alchemy.run.ts`. Прочитай https://v2.alchemy.run/llms.txt.
- **Effect v4** (`effect@next`) — весь runtime-код: сервисы через Context/Layer, Schema, tagged errors, Config.
- **Cloudflare**: Workers, Durable Objects (SQLite), Sandbox SDK / Containers, R2, KV.
- **Telegram Bot API 10.3** — https://core.telegram.org/bots/api и changelog.
- **Claude Code CLI** в контейнере, headless: `claude -p --output-format stream-json --resume <id>`.
- Закрепи точные версии alchemy, effect, `claude` (бета — ждём breaking changes). Если API в документации расходится с тем, что я пишу ниже, — верь документации и скажи мне.

## Конвенции

- Имена файлов и папок — **kebab-case**. Классы, ресурсы, сервисы — PascalCase.
- Стейджи `dev` и `prod`, у `dev` свой тестовый бот.
- Никаких `any`; входящие данные Telegram декодируются через Schema.

## Авторизация Claude и лимиты

- Агент работает на **обычных лимитах моей Claude-подписки**: секрет `CLAUDE_CODE_OAUTH_TOKEN` (из `claude setup-token`).
- Токен используется **только** официальным CLI `claude` внутри контейнера. Никогда не вызывай Anthropic API напрямую с этим токеном и не клади его в заголовки.
- Исчерпание лимита подписки — штатная ситуация: пользователь получает понятное сообщение, а не падение.

## Пользователи и роли

- `ADMIN_TG_ID` — env/Config. Этот аккаунт — админ.
- Остальные допускаются через allowlist в KV (`/allow`, `/revoke` — только админ). Неизвестные — бот молча игнорирует.
- Админу на `/start` и `/help` бот пишет, что он админ, и показывает все команды; обычным — только их команды.
- Единый реестр команд с ролями → из него строятся `/help`, меню (`setMyCommands`: scope `default` для всех, scope `chat` для админа) и проверка доступа. Админ-команды для не-админа — как неизвестные.
- Команды пользователя: `/start`, `/help`, `/new`, `/sessions`, `/stop`.
- Приглашения: `/invite [uses=N] [ttl=7d] [plugins=car] ["заметка"]` создаёт ссылку `t.me/<bot>?start=inv_<code>`, `/invites` — список и отзыв. Хранятся в SQLite DO админа, активация атомарная; неизвестному пользователю бот отвечает только на `/start inv_<code>`.
- Команды админа дополнительно: `/agents`, `/usage`, `/allow <tgId>`, `/revoke <tgId>`, `/kill <tgId>`, `/restart <tgId>`.

## Архитектура

```
Telegram → Worker gateway → DO user-agent (1 на tgId) → Sandbox claude-runner (1 на DO)
                                   ↘ R2 (снапшоты ~/.claude, файлы)   KV (allowlist)
```

1. **gateway** (Worker): проверяет `X-Telegram-Bot-Api-Secret-Token`, декодирует `Update`, определяет роль, сразу отвечает 200, передаёт сообщение в DO `user-agent` по имени `String(tgId)`.
2. **user-agent** (Durable Object, SQLite): сессии и метаданные, очередь — `Semaphore(1)` на сессию, активные запуски в `FiberMap` (прерывание = убийство процесса в контейнере), счётчики использования для `/usage`, дневной лимит запусков на аккаунт.
3. **claude-runner** (Sandbox/Container): образ с закреплённой версией `claude`, Python + DuckDB для аналитики. Стримит события `stream-json` обратно. `sleepAfter: "10m"`. При старте восстанавливает `~/.claude` из R2 (`agents/<tgId>/`), при остановке — сохраняет. Instance type: начни с `basic`, вынеси в Config.
4. **telegram-webhook** — свой ресурс Alchemy: на deploy вызывает `setWebhook` (с secret) и `setMyCommands`, на destroy — `deleteWebhook`.

Сервисы Effect (каждый — Context + Layer, тестируемый с мок-Layer): `telegram`, `allowlist`, `sessions`, `agent-runner`, `commands`, `plugin-registry`. Ошибки tagged: `Unauthorized`, `AgentBusy`, `ContainerDown`, `TelegramError`, `SubscriptionLimitReached`. Ретраи Telegram 429 по `retry_after` через `Schedule`.

## UI в Telegram (используй современные возможности Bot API)

- **Сессии = топики в личном чате** (topics in private chats, `createForumTopic`, `message_thread_id`): каждый топик — отдельная claude-сессия. `/new` создаёт топик.
- **Стриминг ответа** через `sendMessageDraft` / `sendRichMessageDraft` с `can_stop: true`; апдейт `MessageGenerationStopped` = прерывание запуска (то же, что `/stop`). Фоллбек — throttled `editMessageText`.
- **Rich messages** (`sendRichMessage`): таблицы, раскрывающиеся цитаты, кнопки — для отчётов и `/agents`, `/usage`.
- **Inline-кнопки** со `style` для подтверждений опасных действий (kill, revoke).
- Длинные ответы — разбиение с учётом лимитов, файлы — документом.

## Плагины

Плагин — модуль, который добавляет боту возможности, не трогая ядро:

```ts
interface BotPlugin {
  id: string                      // "car"
  commands: CommandDef[]          // с ролями
  tools: AgentTool[]              // инструменты для агента (MCP)
  layer: Layer<...>               // свои ресурсы и сервисы (R2, KV...)
  enabledFor: (tgId) => Effect<boolean>  // включение плагина по аккаунтам (управляет админ)
}
```

- Инструменты плагинов доступны агенту как **MCP-сервер** (HTTP), который поднимает Worker/DO. Контейнер обращается к нему с коротким токеном, привязанным к `tgId`, — агент видит только данные своего аккаунта и только включённые плагины.
- Регистрация плагинов — в одном месте; команды плагина автоматически попадают в `/help` и меню.

### Плагин `car` — аналитика данных машины

Контекст: в соседнем проекте я делаю Android Chrome web app, которое читает данные с машины (OBD) и загружает их в R2. Бот управляет этим и анализирует данные.

- Хранилище: R2, префикс `car/<tgId>/...`. **Формат файлов уточни у меня** перед реализацией парсинга (не придумывай схему).
- Команды: `/car upload` — выдать подписанную ссылку на загрузку в R2 (короткий TTL); `/car trips` — список поездок; `/car report [период]` — отчёт.
- Инструменты агента: `car_list_trips`, `car_get_trip`, `car_query` (агрегации/метрики за период), `car_upload_link`. Тяжёлую аналитику агент делает в sandbox: скачивает данные и считает в DuckDB/Python, возвращает таблицу (rich message) и при необходимости график файлом.
- Пользователь может просто писать агенту: «как изменился расход за месяц?» — агент сам вызывает инструменты.

## Управление и эксплуатация

- CI (GitHub Actions): push в `main` → deploy `prod`; PR → preview-стейдж; закрытие PR → destroy.
- Секреты через `Config.redacted`. Healthcheck проверяет токен Claude и напоминает админу заранее до истечения.
- Все ошибки — короткое уведомление в админ-чат. `Effect.withSpan` на пути webhook → DO → runner, Workers Logs включены.
- Smoke-тест после деплоя: отправить «ping», получить ответ.

## Этапы

1. MVP: один аккаунт, одна сессия, ответ целиком. Деплой через Alchemy, webhook-ресурс.
2. Роли, allowlist, реестр команд, админ-команды.
3. Топики как сессии, стриминг через drafts, `/stop` и `MessageGenerationStopped`.
4. Снапшоты `~/.claude` в R2, лимиты и `/usage`.
5. Система плагинов + MCP-сервер.
6. Плагин `car`.
7. CI, алерты, smoke-тесты.

## Как работать

- Начни с проверки рискованного места: можно ли в Alchemy v2 собрать образ контейнера, где есть и CLI `claude`, и наш Effect-сервер (свой Dockerfile vs сгенерированный образ). Сделай минимальный прототип и доложи.
- Перед каждым этапом — короткий план и список файлов; после — как проверить.
- Если что-то в требованиях противоречит документации или правилам Anthropic/Telegram — остановись и спроси.
