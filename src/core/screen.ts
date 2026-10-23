import type { ScreenDerivedSetting } from '../shared/manifest'
import type { MonitorInfo, Platform } from './platform'

/** A Windows display attached to the desktop. Bounds use desktop coordinates, including negative values. */
export type ScreenMonitor = MonitorInfo

/** The monitor and mode XIV uses, plus the frame cap derived from its refresh rate. */
export interface ResolvedScreen {
  deviceName: string
  refreshHz: number
  width: number
  height: number
  hdrSupported: boolean
  hdrOn: boolean
  peakNits: number | null
  frameCap: number
}

interface XivDisplaySettings {
  mainAdapter?: string
  screenLeft?: number
  screenTop?: number
  screenMode?: number
  screenWidth?: number
  screenHeight?: number
  fullScreenWidth?: number
  fullScreenHeight?: number
  refreshRate?: number
}

/** Parses the simple `<Display Settings>` key/value section in FFXIV.cfg. */
export function parseXivDisplaySettings(text: string | null): XivDisplaySettings {
  if (text === null) return {}
  let inDisplaySettings = false
  const values = new Map<string, string>()
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    const line = rawLine.trim()
    const section = /^<([^>]+)>$/.exec(line)
    if (section) {
      inDisplaySettings = section[1].trim().toLowerCase() === 'display settings'
      continue
    }
    if (!inDisplaySettings || !line) continue
    const setting = /^(\S+)(?:\s+(.*))?$/.exec(line)
    if (setting) values.set(setting[1].toLowerCase(), setting[2]?.trim() ?? '')
  }
  const number = (name: string) => {
    const value = values.get(name.toLowerCase())
    if (value === undefined || !/^-?\d+$/.test(value)) return undefined
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : undefined
  }
  const positive = (name: string) => {
    const value = number(name)
    return value !== undefined && value > 0 ? value : undefined
  }
  return {
    mainAdapter: values.get('mainadapter') || undefined,
    screenLeft: number('screenleft'),
    screenTop: number('screentop'),
    screenMode: number('screenmode'),
    screenWidth: positive('screenwidth'),
    screenHeight: positive('screenheight'),
    fullScreenWidth: positive('fullscreenwidth'),
    fullScreenHeight: positive('fullscreenheight'),
    refreshRate: positive('refreshrate'),
  }
}

/** OptiScaler stores this as a six-place decimal, including for integer caps. */
export function frameCapForRefresh(refreshHz: number): number | null {
  // Windows reports 0 or 1 for a mode's "hardware default" rate: that is no rate, not a cap of 0.
  if (!Number.isFinite(refreshHz) || refreshHz <= 1) return null
  return Math.floor(refreshHz - refreshHz * refreshHz / 3600)
}

/** The monitor's reported peak brightness, kept inside the range OptiScaler's HDR accepts; 1,100 when it reports none. */
export function resolvedPeakNits(peakNits: number | null): number {
  const measured = peakNits !== null && Number.isFinite(peakNits) ? peakNits : 1100
  return Math.min(4000, Math.max(400, Math.round(measured)))
}

/** What the recipe's screen-derived settings are computed from. */
export type ScreenValues = Pick<ResolvedScreen, 'frameCap' | 'peakNits'>

/** The value a screen-derived setting takes on this screen, as the config file writes it. */
export function screenDerivedValue(setting: ScreenDerivedSetting, screen: ScreenValues): string {
  if (setting.value === 'frameCap') return screen.frameCap.toFixed(6)
  if (setting.value === 'peakNits') return String(resolvedPeakNits(screen.peakNits))
  throw new Error(`Unknown screen-derived setting: ${setting.value}`)
}

/** Resolves MainAdapter first, then XIV's stored window position, then the Windows primary monitor. */
export function resolveScreen(monitors: ScreenMonitor[], configText: string | null): ResolvedScreen | null {
  if (!monitors.length) return null
  const config = parseXivDisplaySettings(configText)
  const adapterNumber = config.mainAdapter ? /display\s*(\d+)\b/i.exec(config.mainAdapter)?.[1] : undefined
  const fromAdapter = config.mainAdapter ? monitors.find((monitor) => {
    const monitorNumber = /display(\d+)$/i.exec(monitor.deviceName)?.[1]
    return adapterNumber && monitorNumber ? monitorNumber === adapterNumber
      : config.mainAdapter!.toLowerCase() === monitor.deviceName.toLowerCase()
  }) : undefined
  // XIV uses 0 for windowed, 1 for exclusive full-screen and 2 for borderless full-screen.
  // Windowed uses the saved window size; borderless uses the monitor's active desktop mode.
  const exclusive = config.screenMode === 1
  const windowed = config.screenMode === 0
  const containing = (x: number, y: number) =>
    monitors.find(({ bounds }) => x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom)
  // A window's frame has invisible borders, so a window flush with a monitor's edge starts a few pixels inside the
  // neighbour: its centre, the point Windows itself goes by, decides. Only in windowed mode is the saved size the window's.
  const fromCentre = windowed && config.screenLeft !== undefined && config.screenTop !== undefined
    && config.screenWidth !== undefined && config.screenHeight !== undefined
    ? containing(config.screenLeft + config.screenWidth / 2, config.screenTop + config.screenHeight / 2)
    : undefined
  const fromPosition = config.screenLeft !== undefined && config.screenTop !== undefined
    ? containing(config.screenLeft, config.screenTop)
    : undefined
  const monitor = fromAdapter ?? fromCentre ?? fromPosition ?? monitors.find((candidate) => candidate.primary) ?? monitors[0]
  const refreshHz = exclusive ? config.refreshRate ?? monitor.refreshHz : monitor.refreshHz
  const width = exclusive ? config.fullScreenWidth ?? monitor.width : windowed ? config.screenWidth ?? monitor.width : monitor.width
  const height = exclusive ? config.fullScreenHeight ?? monitor.height : windowed ? config.screenHeight ?? monitor.height : monitor.height
  const frameCap = frameCapForRefresh(refreshHz)
  if (frameCap === null) return null
  return {
    deviceName: monitor.deviceName, refreshHz, width, height,
    hdrSupported: monitor.hdrSupported, hdrOn: monitor.hdrOn, peakNits: monitor.peakNits, frameCap,
  }
}

/** Reads current monitors and the player's FFXIV.cfg; a missing or unreadable config selects the primary monitor. */
export async function readResolvedScreen(platform: Platform): Promise<ResolvedScreen | null> {
  const monitors = await platform.getMonitors()
  let configText: string | null = null
  try {
    const documents = await platform.envFolder('Documents')
    configText = await platform.readText(`${documents}\\My Games\\FINAL FANTASY XIV - A Realm Reborn\\FFXIV.cfg`)
  } catch { /* First launch, a redirected folder, or an unreadable config all fall back to the primary monitor. */ }
  return resolveScreen(monitors, configText)
}
