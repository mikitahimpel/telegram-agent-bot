const required = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === "") {
    console.error(`missing env ${name}`)
    process.exit(2)
  }
  return value
}

const base = required("SMOKE_BASE_URL").replace(/\/+$/, "")
const secret = required("TELEGRAM_WEBHOOK_SECRET")

const failures: Array<string> = []
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`)
  if (!ok) failures.push(name)
}

const pingUpdate = { update_id: Math.floor(Date.now() / 1000) }

const post = (headerSecret: string | undefined) =>
  fetch(`${base}/telegram/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headerSecret === undefined ? {} : { "x-telegram-bot-api-secret-token": headerSecret })
    },
    body: JSON.stringify(pingUpdate)
  })

const health = await fetch(`${base}/health`)
check("GET /health", health.status === 200, String(health.status))

const forbidden = await post("definitely-wrong")
check("webhook rejects a wrong secret", forbidden.status === 403, String(forbidden.status))

const accepted = await post(secret)
check("webhook accepts ping", accepted.status === 200, String(accepted.status))

if (failures.length > 0) {
  console.error(`smoke failed: ${failures.join(", ")}`)
  process.exit(1)
}

export {}
