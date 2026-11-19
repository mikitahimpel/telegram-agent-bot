import { Context } from "effect"
import type { HelpSource } from "@bot/bot-commands/registry"

export class HelpRegistry extends Context.Service<HelpRegistry, HelpSource>()("@bot/HelpRegistry") {}
