import { Context } from "effect"
import type { HelpSource } from "@bot/bot-commands/registry"

/** The assembled registry (core + plugin commands), provided by the gateway so /help lists everything. */
export class HelpRegistry extends Context.Service<HelpRegistry, HelpSource>()("@bot/HelpRegistry") {}
