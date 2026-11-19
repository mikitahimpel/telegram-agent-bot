# Telegram Bot API research (fetched 2026-11-19)

Sources: https://core.telegram.org/bots/api, /bots/api-changelog, /bots/faq.

## Version
- CURRENT = **Bot API 10.4, released November 9, 2026** (Widgets, ephemeral replies to callbacks, TON wallet).
- **10.3 exists** (August 24, 2026) but is NOT current. Its changelog items: RichMessageButton/RichBlockButtons, is_compact table, expandable blockquote block, `can_stop`+`keep_on_stop` on drafts, `MessageGenerationStopped` + `Update.stopped_message_generation`, `DisabledButton`, `force_reply` on InlineKeyboardMarkup, `EphemeralMessageParameters`.
- Timeline: 9.3 (2025-12-31) topics in private chats + sendMessageDraft; 9.4 (2026-02-09) createForumTopic in private chats, button `style`, `allows_users_to_create_topics`; 9.5 (2026-03-01) sendMessageDraft for ALL bots, `date_time` entity; 9.6 (2026-04-03) managed bots; 10.0 (2026-05-08) guest mode, empty-text drafts; 10.1 (2026-06-11) Rich Messages + sendRichMessage/Draft; 10.2 (2026-07-14) InputRichBlock*, ephemeral messages, communities.

## Verdict on claims (all 9 exist)
1 webhook: yes. 2 types + `MessageGenerationStopped`: yes (name exact, 10.3). 3 private-chat topics: yes (9.3/9.4). 4 sendMessageDraft + sendRichMessageDraft + can_stop: yes. 5 sendRichMessage: yes (10.1). 6 button `style`: yes (9.4; values danger/success/primary). 7 commands: yes. 8: yes. Only wrinkle: "10.3" is not the latest; 10.4 is.

## General conventions
- Method call: HTTPS POST `https://api.telegram.org/bot<token>/<method>`; JSON body or multipart/form-data (needed for file upload). Objects in multipart are JSON-serialized strings.
- Response (section "Making requests"): `{ok: true, result: ...}` or `{ok: false, error_code: Integer, description: String, parameters?: ResponseParameters}`. `description` optional; `error_code` "subject to change".
- ResponseParameters: `migrate_to_chat_id?: Integer`, `retry_after?: Integer` (seconds, on flood control). 429 example: `{"ok":false,"error_code":429,"description":"Too Many Requests: retry after 5","parameters":{"retry_after":5}}`.
- Limits (FAQ): ~1 msg/s per chat, 20 msg/min per group, ~30 msg/s bulk broadcast; exceeding gives 429. `allow_paid_broadcast` up to 1000/s for 0.1 Star/msg.
- IDs: chat/user ids up to 52 bits, safe as JS number.

## 1. Webhooks
**setWebhook** -> True
| param | type | req |
|---|---|---|
| url | String | yes (empty string removes webhook) |
| certificate | InputFile | no |
| ip_address | String | no |
| max_connections | Integer 1-100, default 40 | no |
| allowed_updates | Array of String | no (empty list = all except chat_member, message_reaction, message_reaction_count; omitted = keep previous setting) |
| drop_pending_updates | Boolean | no |
| secret_token | String 1-256 chars, [A-Za-z0-9_-] | no |

Header sent on every webhook POST: `X-Telegram-Bot-Api-Secret-Token: <secret_token>` (docs spell it "X-Telegram-Bot-Api-Secret-Token"; HTTP headers are case-insensitive). Ports: 443, 80, 88, 8443. Non-2xx => Telegram retries then gives up. getUpdates is disabled while webhook set. allowed_updates does not affect already-queued updates.
**deleteWebhook** `{drop_pending_updates?: Boolean}` -> True.
Webhook body = JSON `Update`.

## 2. Types (section "Available types")
**Update**: `update_id: Integer` + at most one optional of: message, edited_message, channel_post, edited_channel_post (Message); business_connection; business_message, edited_business_message (Message); deleted_business_messages; guest_message (Message); message_reaction; message_reaction_count; inline_query; chosen_inline_result; **callback_query: CallbackQuery**; widget_query (WidgetQuery, 10.4); shared_widget_query; shipping_query; pre_checkout_query; purchased_paid_media; poll; poll_answer; my_chat_member / chat_member (ChatMemberUpdated); chat_join_request; chat_boost; removed_chat_boost; managed_bot; subscription (BotSubscriptionUpdated); **stopped_message_generation: MessageGenerationStopped**.
Note: update_id may jump randomly after a week idle.

**MessageGenerationStopped** (10.3): `chat: Chat`, `message_thread_id?: Integer`, `draft_id: Integer`. Delivered as `Update.stopped_message_generation` after user taps the stop button shown by `can_stop: true` on a draft. Probably must be included in allowed_updates if you restrict it (add "stopped_message_generation").

**User**: id Integer, is_bot Boolean, first_name String, last_name?, username?, language_code?, is_premium? (True), added_to_attachment_menu?, and getMe-only: can_join_groups?, can_read_all_group_messages?, supports_guest_queries?, supports_inline_queries?, can_connect_to_business?, has_main_web_app?, **has_topics_enabled?: Boolean**, **allows_users_to_create_topics?: Boolean**, can_manage_bots?, supports_join_request_queries?.

**Chat**: id Integer, type "private"|"group"|"supergroup"|"channel", title?, username?, first_name?, last_name?, is_forum? (True; supergroups only), is_direct_messages? (True).

**Message** (needed fields): message_id Integer (0 for ephemeral); message_thread_id? Integer ("supergroups and private chats only"); from? User; sender_chat? Chat; date Integer; chat Chat; is_topic_message? True ("topic in forum supergroup or private chat with the bot"); reply_to_message? Message; edit_date?; text? String; entities? MessageEntity[]; caption?, caption_entities?; document? Document; rich_message? RichMessage; forum_topic_created? ForumTopicCreated; receiver_user?, ephemeral_message_id? (ephemeral msgs); plus many service fields.

**MessageEntity**: type String, offset Integer (UTF-16 units), length Integer (UTF-16), url? (text_link), user? User (text_mention), language? (pre), custom_emoji_id?, unix_time? (date_time), date_time_format? (date_time).
type enum: mention, hashtag, cashtag, bot_command, url, email, phone_number, bank_card_number, ton_address, bold, italic, underline, strikethrough, spoiler, blockquote, expandable_blockquote, code, pre, text_link, text_mention, custom_emoji, date_time.

**CallbackQuery**: id String, from User, message? MaybeInaccessibleMessage (Message, or `{chat, message_id, date: 0}` if inaccessible), inline_message_id?, chat_instance String, data? String, game_short_name?. Exactly one of data/game_short_name. Client shows spinner until answerCallbackQuery.

## 3. Topics in private chats
- Exists since 9.3 (has_topics_enabled, message_thread_id/is_topic_message on private messages, message_thread_id param in send* and sendChatAction, editForumTopic/deleteForumTopic/unpinAllForumTopicMessages in private chats) and 9.4 (**createForumTopic works in private chats**).
- Required setting: "forum topic mode" for the bot in private chats, enabled in the @BotFather Mini App (changelog wording; no BotFather chat command named). Detect via `getMe().has_topics_enabled`. A second BotFather Mini App setting controls whether users may create/delete topics: `allows_users_to_create_topics`. The exact menu label is not in the Bot API docs: verify in BotFather.
- **createForumTopic**: chat_id Integer|String (yes; for private chat pass the user's chat id), name String 1-128 (yes), icon_color Integer (no; one of 7322096, 16766590, 13338331, 9367192, 16749490, 16478047), icon_custom_emoji_id String (no). Returns **ForumTopic** `{message_thread_id: Integer, name, icon_color: Integer, icon_custom_emoji_id?, is_name_implicit?: True}`. Supergroups require can_manage_topics admin right; private chats need no right.
- 10.4: topic link `https://t.me/<bot_username>/<message_thread_id>` (opens only for the user it belongs to).
- **ForumTopicCreated** service message (`Message.forum_topic_created`): name String, icon_color Integer, icon_custom_emoji_id?, is_name_implicit? True (name unspecified by creator, bot likely should rename via editForumTopic). Users creating a topic in the client therefore yield a message with forum_topic_created + message_thread_id.
- Usage: pass `message_thread_id` in sendMessage/sendDocument/sendRichMessage/sendMessageDraft/sendChatAction/etc. Incoming messages in a topic carry `message_thread_id` and `is_topic_message: true`.

## 4. Streaming drafts
**sendMessageDraft** -> True (all bots since 9.5; 9.3 introduced; 10.3 added can_stop/keep_on_stop; 10.0 allows empty text)
| param | type | req |
|---|---|---|
| chat_id | Integer | yes (private chat only) |
| message_thread_id | Integer | no |
| draft_id | Integer, non-zero | yes |
| text | String 0-4096 after entity parsing | no (empty = "Thinking..." placeholder) |
| parse_mode | String | no |
| entities | MessageEntity[] | no |
| can_stop | Boolean | no (shows stop button; triggers `stopped_message_generation` update) |
| keep_on_stop | Boolean | no (keep draft visible on stop; still vanishes after short time or when bot sends a message) |

Semantics: same `draft_id` => updates animate; different id => replaced without animation. The draft is an ephemeral ~30-second preview; when done you MUST call sendMessage (or sendRichMessage) with the final content to persist it. No documented numeric rate limit for drafts beyond general flood control (429).
**sendRichMessageDraft** -> True: same as above but `rich_message: InputRichMessage` (yes) instead of text/parse_mode/entities; no direct file upload or explicit URL upload of files in drafts. Also supports `<tg-thinking>Thinking...</tg-thinking>` (block type "thinking", `{type:"thinking", text: RichText}`) only valid in drafts.

## 5. Rich messages (10.1+)
**sendRichMessage** -> Message. Params: business_connection_id?, chat_id? (Integer|String; optional only for ephemeral callback replies), message_thread_id?, direct_messages_topic_id?, ephemeral_message_parameters?, **rich_message: InputRichMessage (yes)**, disable_notification?, protect_content?, allow_paid_broadcast?, message_effect_id?, suggested_post_parameters?, reply_parameters? (ReplyParameters), reply_markup? (InlineKeyboardMarkup|ReplyKeyboardMarkup|ReplyKeyboardRemove|ForceReply).
**InputRichMessage**: exactly one of `html: String`, `markdown: String`, `blocks: InputRichBlock[]`; plus `media?: InputRichMessageMedia[]` ({id: String 1-64 [A-Za-z0-9_-], media: InputMediaAnimation|Audio|Document|Photo|Video|VoiceNote}; referenced via tg://photo?id= etc.), `is_rtl?`, `skip_entity_detection?`.
**Edit**: `editMessageText` accepts `rich_message` instead of `text` (one of the two required).
**Message.rich_message: RichMessage** `{blocks: RichBlock[], is_rtl?: Boolean}`.
Limits: 32768 UTF-8 chars, 500 blocks, 16 nesting levels, 50 media, 20 table columns. (The 4096 limit does not apply.)
Capabilities:
- Tables: HTML `<table><tr><th>..</th></tr><tr><td>..</td></tr></table>` or GFM pipe tables (cells inline-only). Block `InputRichBlockTable {type:"table", cells: RichBlockTableCell[][], is_bordered?, is_striped?, is_compact?(10.3), caption?: RichText}`.
- Expandable blockquote: HTML `<blockquote expandable>..<cite>credit</cite></blockquote>`; block `{type:"expandable_blockquote", text: RichText, credit?: RichText}` (10.3). Also `<details open><summary>`, pull quote `<aside>`.
- Code: `<pre><code class="language-python">`; block `{type:"pre", text, language?}`. Markdown fenced code too.
- Also headings h1-h6, lists/checklists, footnotes (`<tg-reference>`), math `<tg-math>`/$..$, media/figure, `<tg-document>`, map, collage/slideshow, `<tg-time>`, spoiler, `<mark>`, sub/sup.
- Buttons (10.3): HTML `<tg-button-row align="left|center|right"><tg-button type="url|callback_data|web_app|login_url|switch_inline_query|switch_inline_query_current_chat|switch_inline_query_chosen_chat|copy_text|disabled" style="primary|success|danger|link" data="..." url="...">label</tg-button></tg-button-row>`; also inline `<tg-button>` inside `<p>`. Block `InputRichBlockButtons {type:"buttons", buttons: RichMessageButton[] (1-8), align?: "left"|"center"|"right"}`.
  **RichMessageButton**: text: RichText (plain/custom emoji/date_time only), style? "danger"|"success"|"primary"|"link" ("link" only for callback buttons), and exactly one of url, callback_data (1-64 bytes), web_app, login_url, switch_inline_query, switch_inline_query_current_chat, switch_inline_query_chosen_chat, copy_text, disabled (DisabledButton).
  Button taps arrive as ordinary `callback_query` presumably (docs describe callback_data "sent in a callback query"; confirm empirically that CallbackQuery.message is the rich message).
- Plain URLs/mentions/hashtags/commands auto-detected unless skip_entity_detection.
- Rich Markdown (GFM-like) is the simplest LLM-output path: pass LLM markdown as `markdown`.
Classic alternative (still valid): sendMessage with parse_mode "HTML": `<blockquote expandable>`, `<pre><code class="language-x">`, `<b> <i> <s> <u> <tg-spoiler> <a href> <code>`; no tables; 4096 limit. MessageEntity types `expandable_blockquote`, `pre` for entity mode.

## 6. Inline keyboards
**InlineKeyboardMarkup**: `inline_keyboard: InlineKeyboardButton[][]`, `force_reply?: Boolean` (10.3).
**InlineKeyboardButton**: text String (req); icon_custom_emoji_id?; **style?: "danger" (red) | "success" (green) | "primary" (blue)**; omitted => app-specific. Exactly one action field of: url, callback_data (String **1-64 bytes**), web_app (WebAppInfo), login_url, switch_inline_query, switch_inline_query_current_chat, switch_inline_query_chosen_chat, copy_text (CopyTextButton), callback_game, pay (Boolean), disabled (DisabledButton `{}`, 10.3).
**answerCallbackQuery** -> True: callback_query_id String (yes); text? String 0-200 chars; show_alert? Boolean (default false); url? String; cache_time? Integer (default 0).
Edit markup: editMessageReplyMarkup / editMessageText `reply_markup: InlineKeyboardMarkup`.
10.4: ephemeral reply to a callback by `ephemeral_message_parameters.callback_query_id` without chat_id.

## 7. Commands
**setMyCommands** -> True: `commands: BotCommand[]` (yes, max 100), `scope?: BotCommandScope` (default BotCommandScopeDefault), `language_code?: String` (ISO 639-1).
**BotCommand**: command String 1-32 [a-z0-9_], description String 1-256, is_ephemeral? Boolean (10.2).
**deleteMyCommands** -> True: `scope?`, `language_code?`. getMyCommands same params -> BotCommand[].
BotCommandScope variants (discriminator `type`): `default`; `all_private_chats`; `all_group_chats`; `all_chat_administrators`; `chat` {chat_id: Integer|String}; `chat_administrators` {chat_id}; `chat_member` {chat_id, user_id}. (chat scope excludes channels and channel DM chats.) Narrower scope overrides broader.

## 8. Core methods
**sendMessage** -> Message: chat_id Integer|String (optional only for ephemeral callback replies; otherwise required), text String 1-4096 after entity parsing (yes), message_thread_id?, parse_mode?, entities?, link_preview_options? {is_disabled?, url?, prefer_small_media?, prefer_large_media?, show_above_text?}, disable_notification?, protect_content?, allow_paid_broadcast?, message_effect_id?, reply_parameters? {message_id?, chat_id?, ephemeral_message_id?, allow_sending_without_reply?, quote?, quote_parse_mode?, quote_entities?, quote_rich_texts?, quote_position?, checklist_task_id?, poll_option_id?}, reply_markup?, business_connection_id?, direct_messages_topic_id?, ephemeral_message_parameters?, suggested_post_parameters?.
**editMessageText** -> Message | True (inline): chat_id?+message_id? (or inline_message_id), text? (1-4096) OR rich_message?, parse_mode?, entities?, link_preview_options?, reply_markup? InlineKeyboardMarkup, business_connection_id?. Error "message is not modified" if identical.
**sendDocument** -> Message (multipart/form-data for upload): chat_id, message_thread_id?, **document: InputFile|String (yes; file_id, HTTP URL, or upload)**, thumbnail? (JPEG <200kB, <=320px, upload only, `attach://name`), caption? 0-1024, parse_mode?, caption_entities?, disable_content_type_detection?, disable_notification?, protect_content?, allow_paid_broadcast?, message_effect_id?, reply_parameters?, reply_markup?, etc. Upload max 50 MB.
**sendChatAction** -> True: chat_id (yes; channels unsupported), action (yes): typing, upload_photo, record_video, upload_video, record_voice, upload_voice, upload_document, choose_sticker, find_location, record_video_note, upload_video_note; message_thread_id? (private chats with topics supported); business_connection_id?. Lasts <=5 s.
Length limits: message text 4096, caption 1024, callback_data 64 bytes, rich message 32768 chars.
Entities offsets are UTF-16 code units.

## 9. Other new things relevant to an AI-agent bot
- Rich Messages + streaming: `sendRichMessageDraft` (10.1, "stream AI-generated replies with seamless rich formatting"), `<tg-thinking>` block, recommended custom-emoji pack https://t.me/addemoji/AIActions.
- Stop generation: `can_stop`, `keep_on_stop`, `MessageGenerationStopped` (10.3). On the update, abort the LLM run; send final partial via sendMessage if wanted.
- Bot username suffixes "agent"/"ai"/"app"/"game" for Premium owners (10.4).
- Bot-to-bot messaging by username if both bots enable it (10.0); guest mode: bot answers in chats it is not a member of via `Update.guest_message` + `answerGuestQuery` (10.0).
- Managed bots (9.6): getManagedBotToken, replaceManagedBotToken, ManagedBotUpdated.
- Ephemeral messages (10.2/10.3/10.4): messages visible only to a user in groups (`ephemeral_message_parameters`, edit/deleteEphemeralMessage).
- Widgets (10.4): sendWidget (HTML mini-widgets, private chats only), WidgetQuery updates.
- Button `style` and custom-emoji icons (9.4); custom emoji in bot messages if owner has Premium.
- `date_time` entity (9.5), tag fields (9.5), `setMyProfilePhoto` (9.4).
- Not found: no separate "AI bot" flag or bot-to-user streaming API other than sendMessageDraft/sendRichMessageDraft.

## Open items to verify empirically
- Exact BotFather Mini App label for private-chat topic mode.
- Draft rate limits and whether the draft respects message_thread_id in private topics (documented param, so yes).
- How rich-message button taps appear in CallbackQuery.message.
