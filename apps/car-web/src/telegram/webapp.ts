/** Minimal typed wrapper over the Telegram WebApp SDK. Every call is a safe no-op outside Telegram. */

interface TgButton {
  show(): void
  hide(): void
  onClick(cb: () => void): void
  offClick(cb: () => void): void
}
interface TgMainButton extends TgButton {
  setText(text: string): void
  showProgress(leaveActive?: boolean): void
  hideProgress(): void
  enable(): void
  disable(): void
}
export interface TgWebApp {
  initData: string
  initDataUnsafe: { user?: { language_code?: string; first_name?: string } }
  colorScheme: "light" | "dark"
  ready(): void
  expand(): void
  close(): void
  openLink(url: string, opts?: { try_instant_view?: boolean }): void
  openTelegramLink(url: string): void
  enableClosingConfirmation(): void
  disableClosingConfirmation(): void
  onEvent(name: string, cb: () => void): void
  offEvent(name: string, cb: () => void): void
  MainButton: TgMainButton
  BackButton: TgButton
  HapticFeedback: {
    impactOccurred(style: "light" | "medium" | "heavy"): void
    notificationOccurred(type: "error" | "success" | "warning"): void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp }
  }
}

export interface MainButtonConfig {
  text: string
  visible: boolean
  enabled: boolean
  loading: boolean
  onClick: () => void
}

export interface TelegramApi {
  readonly available: boolean
  readonly initData: string
  readonly languageCode: string | undefined
  ready(): void
  expand(): void
  close(): void
  openLink(url: string): void
  openTelegramLink(url: string): void
  setClosingConfirmation(on: boolean): void
  setMainButton(cfg: MainButtonConfig | null): void
  setBackButton(onClick: (() => void) | null): void
  haptic(kind: "light" | "success" | "warning" | "error"): void
  onThemeChanged(cb: () => void): () => void
}

export const makeTelegram = (w: TgWebApp | undefined): TelegramApi => {
  const available = !!w && w.initData.length > 0
  let mainCb: (() => void) | null = null
  let backCb: (() => void) | null = null
  return {
    available,
    initData: w?.initData ?? "",
    languageCode: w?.initDataUnsafe?.user?.language_code,
    ready: () => w?.ready(),
    expand: () => w?.expand(),
    close: () => w?.close(),
    openLink: (url) => (w && available ? w.openLink(url) : void window.open(url, "_blank")),
    openTelegramLink: (url) => (w && available ? w.openTelegramLink(url) : void window.open(url, "_blank")),
    setClosingConfirmation: (on) => {
      if (!w) return
      if (on) w.enableClosingConfirmation()
      else w.disableClosingConfirmation()
    },
    setMainButton: (cfg) => {
      if (!w) return
      const b = w.MainButton
      if (mainCb) b.offClick(mainCb)
      mainCb = null
      if (!cfg || !cfg.visible) return b.hide()
      b.setText(cfg.text)
      if (cfg.enabled) b.enable()
      else b.disable()
      if (cfg.loading) b.showProgress(false)
      else b.hideProgress()
      mainCb = cfg.onClick
      b.onClick(mainCb)
      b.show()
    },
    setBackButton: (onClick) => {
      if (!w) return
      const b = w.BackButton
      if (backCb) b.offClick(backCb)
      backCb = null
      if (!onClick) return b.hide()
      backCb = onClick
      b.onClick(onClick)
      b.show()
    },
    haptic: (kind) => {
      if (!w) return
      if (kind === "light") w.HapticFeedback.impactOccurred("light")
      else w.HapticFeedback.notificationOccurred(kind)
    },
    onThemeChanged: (cb) => {
      w?.onEvent("themeChanged", cb)
      return () => w?.offEvent("themeChanged", cb)
    }
  }
}

export const getTelegram = (): TelegramApi => makeTelegram(typeof window === "undefined" ? undefined : window.Telegram?.WebApp)
