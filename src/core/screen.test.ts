import { describe, expect, it } from 'vitest'
import { frameCapForRefresh, parseXivDisplaySettings, resolveScreen, type ScreenMonitor } from './screen'
import { readResolvedScreen } from './screen'
import { createFakePlatform } from '../platform/fake'
import { MACHINES } from '../platform/fixtures'

const monitor = (deviceName: string, left: number, primary: boolean, refreshHz: number, hdrSupported = false, hdrOn = false): ScreenMonitor => ({
  deviceName, bounds: { left, top: 0, right: left + 3840, bottom: 2160 }, primary,
  refreshHz, width: 3840, height: 2160, hdrSupported, hdrOn, peakNits: hdrSupported ? 1000 : null,
})
const displayConfig = (values: string) => `<Version>\r\nConfigVersion 2\r\n<Display Settings>\r\n${values}\r\n<Graphics Settings>\r\nGeneralQuality 1\r\n`

describe('XIV screen resolution', () => {
  it.each([[60, 59], [144, 138], [240, 224]])('derives a frame cap of %i Hz -> %i fps', (refresh, cap) => {
    expect(frameCapForRefresh(refresh)).toBe(cap)
  })

  it('uses MainAdapter even when the stored window origin is on another monitor', () => {
    const monitors = [monitor('\\\\.\\DISPLAY1', 0, true, 60), monitor('\\\\.\\DISPLAY2', 3840, false, 240, true, true)]
    const screen = resolveScreen(monitors, displayConfig([
      'MainAdapter NVIDIA GeForce RTX 4090 (\\\\.\\DISPLAY2)', 'ScreenLeft 10', 'ScreenTop 10',
      'ScreenMode 1', 'FullScreenWidth 2560', 'FullScreenHeight 1440', 'Refreshrate 240',
    ].join('\r\n')))
    expect(screen).toEqual({ deviceName: '\\\\.\\DISPLAY2', refreshHz: 240, width: 2560, height: 1440, hdrSupported: true, hdrOn: true, peakNits: 1000, frameCap: 224 })
  })

  it('uses the monitor containing ScreenLeft and ScreenTop when MainAdapter is unset', () => {
    const monitors = [monitor('\\\\.\\DISPLAY1', 0, true, 60), monitor('\\\\.\\DISPLAY2', 3840, false, 144)]
    const screen = resolveScreen(monitors, displayConfig([
      'MainAdapter', 'ScreenLeft 4000', 'ScreenTop 83', 'ScreenMode 0', 'ScreenWidth 1280', 'ScreenHeight 720',
    ].join('\n')))
    expect(screen).toMatchObject({ deviceName: '\\\\.\\DISPLAY2', refreshHz: 144, width: 1280, height: 720, frameCap: 138 })
  })

  it('uses the current monitor dimensions in borderless mode and does not confuse display numbers', () => {
    const monitors = [monitor('\\\\.\\DISPLAY1', 0, true, 60), monitor('\\\\.\\DISPLAY10', 3840, false, 240)]
    const screen = resolveScreen(monitors, displayConfig('MainAdapter NVIDIA (\\\\.\\DISPLAY10)\nScreenLeft 5\nScreenTop 5\nScreenMode 2\nScreenWidth 1280\nScreenHeight 720'))
    expect(screen).toMatchObject({ deviceName: '\\\\.\\DISPLAY10', width: 3840, height: 2160, refreshHz: 240 })
    const unmatched = resolveScreen(monitors, displayConfig('MainAdapter NVIDIA (\\\\.\\DISPLAY100)\nScreenLeft 4000\nScreenTop 5'))
    expect(unmatched?.deviceName).toBe('\\\\.\\DISPLAY10')
  })

  it('supports negative monitor coordinates and uses the primary monitor when no position matches', () => {
    const monitors = [monitor('\\\\.\\DISPLAY1', 0, true, 60), monitor('\\\\.\\DISPLAY2', -1920, false, 144)]
    expect(resolveScreen(monitors, displayConfig('ScreenLeft -1900\nScreenTop 100'))?.deviceName).toBe('\\\\.\\DISPLAY2')
    expect(resolveScreen(monitors, displayConfig('MainAdapter\nScreenLeft 9000\nScreenTop 9000'))?.deviceName).toBe('\\\\.\\DISPLAY1')
  })

  it('falls back to primary monitor when cfg is missing and parses only the display section', () => {
    const monitors = [monitor('\\\\.\\DISPLAY1', 0, false, 144), monitor('\\\\.\\DISPLAY2', 1920, true, 240, true, false)]
    expect(resolveScreen(monitors, null)).toMatchObject({ deviceName: '\\\\.\\DISPLAY2', refreshHz: 240, hdrSupported: true, hdrOn: false })
    expect(parseXivDisplaySettings('<Other>\nScreenMode 1\n<Display Settings>\nScreenMode 0').screenMode).toBe(0)
  })

  it('falls back to the primary monitor when Documents or FFXIV.cfg cannot be read', async () => {
    const platform = createFakePlatform({ monitors: [monitor('\\\\.\\DISPLAY1', 0, false, 60), monitor('\\\\.\\DISPLAY2', 1920, true, 144)] })
    await expect(readResolvedScreen(platform)).resolves.toMatchObject({ deviceName: '\\\\.\\DISPLAY2', refreshHz: 144, frameCap: 138 })
    const blockedDocuments = createFakePlatform({ monitors: [monitor('\\\\.\\DISPLAY1', 0, true, 60)], env: { Documents: 'Z:\\Blocked' } })
    blockedDocuments.envFolder = async () => { throw new Error('unavailable') }
    await expect(readResolvedScreen(blockedDocuments)).resolves.toMatchObject({ deviceName: '\\\\.\\DISPLAY1', refreshHz: 60, frameCap: 59 })
  })

  it('returns no screen when Windows has no attached monitors or a usable refresh rate', () => {
    expect(resolveScreen([], null)).toBeNull()
    expect(resolveScreen([{ ...monitor('\\\\.\\DISPLAY1', 0, true, 60), refreshHz: 0 }], null)).toBeNull()
  })

  it.each([
    ['screen60Sdr', 60, 59, false, false, '\\\\.\\DISPLAY1'],
    ['screen144Hdr', 144, 138, true, true, '\\\\.\\DISPLAY1'],
    ['screen240Dual', 240, 224, true, true, '\\\\.\\DISPLAY2'],
  ] as const)('resolves the %s browser gallery machine', async (name, refreshHz, frameCap, hdrSupported, hdrOn, deviceName) => {
    const screen = await readResolvedScreen(createFakePlatform(MACHINES[name]))
    expect(screen).toMatchObject({ refreshHz, frameCap, hdrSupported, hdrOn, deviceName })
  })
})
