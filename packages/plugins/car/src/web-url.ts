import { Context } from "effect"

export class CarWebUrl extends Context.Service<CarWebUrl, string>()("@bot/plugins-car/CarWebUrl") {}
