import { Effect, Schema } from "effect"

const Id = Schema.Number
const Opt = <S extends Schema.Constraint>(s: S) => Schema.optionalKey(s)

export const User = Schema.Struct({
  id: Id,
  is_bot: Schema.Boolean,
  first_name: Schema.String,
  username: Opt(Schema.String),
  language_code: Opt(Schema.String),
  has_topics_enabled: Opt(Schema.Boolean)
})
export type User = typeof User.Type

export const Chat = Schema.Struct({
  id: Id,
  type: Schema.String,
  title: Opt(Schema.String),
  username: Opt(Schema.String),
  first_name: Opt(Schema.String)
})
export type Chat = typeof Chat.Type

export const MessageEntity = Schema.Struct({
  type: Schema.String,
  offset: Schema.Number,
  length: Schema.Number,
  url: Opt(Schema.String),
  language: Opt(Schema.String)
})
export type MessageEntity = typeof MessageEntity.Type

export const Document = Schema.Struct({
  file_id: Schema.String,
  file_unique_id: Schema.String,
  file_name: Opt(Schema.String),
  mime_type: Opt(Schema.String),
  file_size: Opt(Schema.Number)
})
export type Document = typeof Document.Type

export const PhotoSize = Schema.Struct({
  file_id: Schema.String,
  file_unique_id: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  file_size: Opt(Schema.Number)
})
export type PhotoSize = typeof PhotoSize.Type

export const Voice = Schema.Struct({
  file_id: Schema.String,
  file_unique_id: Schema.String,
  duration: Schema.Number,
  mime_type: Opt(Schema.String),
  file_size: Opt(Schema.Number)
})
export type Voice = typeof Voice.Type

export const Audio = Schema.Struct({
  file_id: Schema.String,
  file_unique_id: Schema.String,
  duration: Schema.Number,
  file_name: Opt(Schema.String),
  mime_type: Opt(Schema.String),
  file_size: Opt(Schema.Number)
})
export type Audio = typeof Audio.Type

export const VideoNote = Schema.Struct({
  file_id: Schema.String,
  file_unique_id: Schema.String,
  length: Schema.Number,
  duration: Schema.Number,
  file_size: Opt(Schema.Number)
})
export type VideoNote = typeof VideoNote.Type

export const TelegramFile = Schema.Struct({
  file_id: Schema.String,
  file_unique_id: Schema.String,
  file_size: Opt(Schema.Number),
  file_path: Opt(Schema.String)
})
export type TelegramFile = typeof TelegramFile.Type

export const ForumTopicCreated = Schema.Struct({
  name: Schema.String,
  icon_color: Opt(Schema.Number),
  icon_custom_emoji_id: Opt(Schema.String),
  is_name_implicit: Opt(Schema.Boolean)
})
export type ForumTopicCreated = typeof ForumTopicCreated.Type

const messageFields = {
  message_id: Id,
  message_thread_id: Opt(Id),
  from: Opt(User),
  date: Schema.Number,
  chat: Chat,
  is_topic_message: Opt(Schema.Boolean),
  text: Opt(Schema.String),
  entities: Opt(Schema.Array(MessageEntity)),
  caption: Opt(Schema.String),
  caption_entities: Opt(Schema.Array(MessageEntity)),
  document: Opt(Document),
  photo: Opt(Schema.Array(PhotoSize)),
  voice: Opt(Voice),
  audio: Opt(Audio),
  video_note: Opt(VideoNote),
  media_group_id: Opt(Schema.String),
  forum_topic_created: Opt(ForumTopicCreated)
}

export const ShallowMessage = Schema.Struct(messageFields)
export type ShallowMessage = typeof ShallowMessage.Type

export const Message = Schema.Struct({
  ...messageFields,
  reply_to_message: Opt(ShallowMessage)
})
export type Message = typeof Message.Type

export const CallbackQuery = Schema.Struct({
  id: Schema.String,
  from: User,
  message: Opt(Message),
  data: Opt(Schema.String)
})
export type CallbackQuery = typeof CallbackQuery.Type

export const MessageGenerationStopped = Schema.Struct({
  chat: Chat,
  message_thread_id: Opt(Id),
  draft_id: Id
})
export type MessageGenerationStopped = typeof MessageGenerationStopped.Type

export const Update = Schema.Struct({
  update_id: Id,
  message: Opt(Message),
  edited_message: Opt(Message),
  callback_query: Opt(CallbackQuery),
  stopped_message_generation: Opt(MessageGenerationStopped)
})
export type Update = typeof Update.Type

export const decodeUpdate: (u: unknown) => Effect.Effect<Update, Schema.SchemaError> = Schema.decodeUnknownEffect(Update)
