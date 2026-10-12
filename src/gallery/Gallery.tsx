// DEV ONLY: the state gallery. Renders each screen state from a real core on the fake Platform, so the
// look can be reviewed by eye without touching a game folder. Open with `?gallery` (or `?gallery=<state>`).
// The bar is deliberately styled unlike Lucent, so it reads as tooling.
import { useEffect, useState } from 'react'
import { createCore, type Core } from '../core/core'
import { createFakePlatform, type Machine } from '../platform/fake'
import { MACHINES, machine, steam, steamGameFolder, vanillaGame, xivLauncher } from '../platform/fixtures'
import { App } from '../ui/App'
import { CoreContext } from '../ui/useCore'
import './gallery.css'

const LONG_LIBRARY = 'E:\\Games\\Libraries\\Steam Library (fast NVMe drive)'

const scanned = (m: Machine) => async () => {
  const core = createCore(createFakePlatform(m))
  await core.scan()
  return core
}

const STATES: { key: string; label: string; setup: () => Promise<Core> }[] = [
  {
    key: 'scanning',
    label: 'Scan · looking',
    async setup() {
      const platform = createFakePlatform(MACHINES.steam)
      platform.hold()
      const core = createCore(platform)
      void core.scan()
      return core
    },
  },
  { key: 'xivlauncher', label: 'Scan · found through XIVLauncher', setup: scanned(MACHINES.xivlauncher) },
  { key: 'steam', label: 'Scan · found in a Steam library', setup: scanned(MACHINES.steam) },
  { key: 'squareenix', label: 'Scan · found through the Square Enix launcher', setup: scanned(MACHINES.squareenix) },
  {
    key: 'long-path',
    label: 'Scan · found, long path',
    setup: scanned(machine(steam({ libraries: [LONG_LIBRARY], game: LONG_LIBRARY }), vanillaGame(steamGameFolder(LONG_LIBRARY)))),
  },
  {
    key: 'no-version',
    label: 'Scan · found, no version file',
    setup: scanned(machine(xivLauncher('D:\\XIV'), { files: { 'D:\\XIV\\game\\ffxiv_dx11.exe': 'MZ' } })),
  },
  { key: 'not-found', label: 'Scan · not found', setup: scanned(MACHINES.none) },
  {
    key: 'rejected',
    label: 'Scan · picked a folder without the game',
    async setup() {
      const platform = createFakePlatform(MACHINES.none)
      const core = createCore(platform)
      await core.scan()
      platform.answerPicker('C:\\Users\\Player\\Downloads')
      await core.chooseGameFolder()
      return core
    },
  },
]

export function Gallery() {
  const initial = new URLSearchParams(location.search).get('gallery')
  const [index, setIndex] = useState(Math.max(0, STATES.findIndex((s) => s.key === initial)))
  const [core, setCore] = useState<Core | null>(null)
  const state = STATES[index]

  useEffect(() => {
    let live = true
    history.replaceState(null, '', `?gallery=${state.key}`)
    void state.setup().then((c) => live && setCore(c))
    return () => {
      live = false
    }
  }, [state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + STATES.length) % STATES.length)
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % STATES.length)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {core && (
        <CoreContext.Provider value={core} key={state.key}>
          <App />
        </CoreContext.Provider>
      )}
      <div className="gallery-bar" role="toolbar" aria-label="State gallery">
        <b>Gallery</b>
        <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {STATES.map((s, i) => (
            <option key={s.key} value={i}>
              {s.label}
            </option>
          ))}
        </select>
        <span>← →</span>
      </div>
    </>
  )
}
