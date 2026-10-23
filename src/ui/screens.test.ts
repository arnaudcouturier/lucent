// What the screens say, rendered to static markup against a real core on the fake platform. Effects, focus and layout
// need a browser; these tests cover the text and the accessible names, which a regression there would silently drop.
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createCore, type Core } from '../core/core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { CoreContext } from './useCore'
import { Keys, ReviewScreen, StatusCard } from './DeploymentScreens'
import { SettingsScreen } from './MainScreens'
import { VersionsScreen } from './VersionsScreen'
import { Rail } from './Rail'
import { SectionContext, type Section } from './Window'
import { whyGameActionsWait } from './gameWaiting'
import { statusCard } from '../core/statusCard'

const ROOT = 'C:\\Games\\XIV'
const RADEON = graphicsCard('AMD Radeon RX 7900 XTX', 0x1002).gpus!

/** The text a player reads: tags gone and a path split by <wbr> in one piece. */
const visibleText = (element: ReactElement, core: Core) =>
  renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, element)).replace(/<wbr\/>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

async function deployedOnRtx() {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return { platform, m }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

/** A deployed RTX machine whose graphics card was swapped for a Radeon, scanned again. */
async function afterGpuSwap() {
  const { platform, m } = await deployedOnRtx()
  m.gpus = RADEON
  return reopen(platform)
}

it('the tier switch card tells the player their config files are backed up and written again', async () => {
  const text = visibleText(createElement(StatusCard), await afterGpuSwap())
  expect(text).toContain('Switch tier')
  // The Reset path rewrites ReShade.ini and OptiScaler.ini, so "your own changes stay as they are" would be false.
  expect(text).not.toContain('your own changes stay')
  expect(text).toContain('Enabled stays as it is')
  expect(text).toContain('Your config files are backed up, then written again.')
})

it('Review for a tier switch says where the current config files are backed up', async () => {
  const core = await afterGpuSwap()
  await core.switchTier()
  await core.review()
  const backup = core.getState().resetBackupPath!
  expect(backup).toContain('Backups')
  const text = visibleText(createElement(ReviewScreen), core)
  expect(text).toContain(`Your current config files will be backed up first at ${backup}`)
})

it('Review for a Reset says where the current config files are backed up', async () => {
  const { platform } = await deployedOnRtx()
  const core = await reopen(platform)
  await core.resetSetup()
  await core.review()
  expect(core.getState().setupMode).toBe('reset')
  const text = visibleText(createElement(ReviewScreen), core)
  expect(text).toContain(`Your current config files will be backed up first at ${core.getState().resetBackupPath}`)
})

it('Review for a first install has no config backup line', async () => {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT)))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  expect(core.getState().setupMode).toBe('install')
  expect(visibleText(createElement(ReviewScreen), core)).not.toContain('config files will be backed up first')
})

it('Keys gives a screen reader the combination as text, and hides only the keycaps it duplicates', () => {
  const markup = renderToStaticMarkup(createElement(Keys, { keys: ['Ctrl', 'Shift', 'F2'] }))
  // An aria-label on a role-less span is ignored, and an aria-hidden on every kbd left nothing to announce.
  expect(markup).not.toContain('aria-label')
  expect(markup).toContain('<span class="sr-only">Ctrl + Shift + F2</span>')
  expect(markup.match(/<kbd aria-hidden="true">/g)).toHaveLength(3)
  expect(markup.match(/<span class="keys-plus" aria-hidden="true">\+<\/span>/g)).toHaveLength(2)
})

describe('Settings explains why Reset setup and Uninstall are disabled', () => {
  it('says XIV is running, in the status card’s words, while the game runs', async () => {
    const { platform, m } = await deployedOnRtx()
    const core = await reopen(platform)
    expect(visibleText(createElement(SettingsScreen), core)).not.toContain('XIV is running')
    m.gameRunning = true
    await core.refreshGameRunning()
    const text = visibleText(createElement(SettingsScreen), core)
    expect(text).toContain('XIV is running. Changes wait until you close the game. Your actions will return automatically.')
    // The same words as Home's card.
    expect(visibleText(createElement(StatusCard), core)).toContain('XIV is running Changes wait until you close the game. Your actions will return automatically.')
  })

  it('names the cause in the order the status card does', () => {
    const found = { status: 'found', path: ROOT, source: 'xivlauncher', version: null } as const
    const missing = { status: 'missing', path: ROOT } as const
    expect(whyGameActionsWait({ busy: false, gameRunning: true, gameFolder: found })).toBe('running')
    expect(whyGameActionsWait({ busy: false, gameRunning: true, gameFolder: missing })).toBe('running')
    expect(whyGameActionsWait({ busy: false, gameRunning: null, gameFolder: found })).toBe('check-failed')
    expect(whyGameActionsWait({ busy: false, gameRunning: false, gameFolder: missing })).toBe('folder-missing')
    // Something else is running: the status card shows its progress, and nothing here says otherwise.
    expect(whyGameActionsWait({ busy: true, gameRunning: null, gameFolder: found })).toBeNull()
    expect(whyGameActionsWait({ busy: false, gameRunning: false, gameFolder: found })).toBeNull()
  })
})

it('Settings offers Change… beside Scan, and says so when the picked folder doesn’t hold the game', async () => {
  const { platform } = await deployedOnRtx()
  const core = await reopen(platform)
  expect(visibleText(createElement(SettingsScreen), core)).toContain(`${ROOT} XIVLauncher · game 2026.09.30.0000.0000 Change… Scan`)
  platform.answerPicker('F:\\Downloads')
  await core.changeGameFolder()
  expect(visibleText(createElement(SettingsScreen), core)).toContain('F:\\Downloads doesn’t hold the game. Pick the folder that contains game\\ffxiv_dx11.exe')
})

describe('the setup rail while Mods is open', () => {
  const railMarkup = async (section: Section) => {
    const core = createCore(createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))))
    await core.scan()
    return renderToStaticMarkup(createElement(CoreContext.Provider, { value: core },
      createElement(SectionContext.Provider, { value: { section, setSection: () => {} } }, createElement(Rail))))
  }
  const stepRow = (markup: string) => markup.match(/<li class="is-now[^"]*"[^>]*>/)?.[0]

  it('marks the current step as the place in setup', async () => {
    const row = stepRow(await railMarkup('home'))
    expect(row).toBe('<li class="is-now" aria-current="step">')
  })

  it('keeps the step’s marker but drops its row highlight and aria-current, so only Mods looks active', async () => {
    const markup = await railMarkup('mods')
    expect(stepRow(markup)).toBe('<li class="is-now is-away">')
    expect(markup).toContain('class="rail-nav-item is-active" aria-current="page"')
    expect(markup.match(/aria-current/g)).toHaveLength(1)
  })
})

it('the config files the tier switch card promises to back up are in the folder Review names, also when the new tier drops one', async () => {
  const { platform, m } = await deployedOnRtx()
  const game = `${ROOT}\\game`
  await platform.writeText(`${game}\\OptiScaler.ini`, '[Upscalers]\nDx11Upscaler=player-choice\n')
  await platform.writeText(`${game}\\ReShade.ini`, '[GENERAL]\nPresetPath=.\\reshade-presets\\Mine.ini\n')
  m.gpus = RADEON
  const core = await reopen(platform)
  await core.switchTier()
  await core.review()
  // A finished switch prepares the next backup folder, so the one Review shows has to be read first.
  const backup = core.getState().resetBackupPath!
  expect(visibleText(createElement(ReviewScreen), core)).toContain(backup)
  await core.deploy()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${backup}\\OptiScaler.ini`)).toBe('[Upscalers]\nDx11Upscaler=player-choice\n')
  expect(await platform.readText(`${backup}\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=.\\reshade-presets\\Mine.ini\n')
})

it('the drift card offers its files behind a collapsed Show files, so the card stays short until asked', async () => {
  const { platform } = await deployedOnRtx()
  await platform.writeText(`${ROOT}\\game\\winmm.dll`, 'Patched')
  await platform.removeFile(`${ROOT}\\game\\ReShade64.dll`)
  const core = await reopen(platform)
  const card = statusCard(core.getState())
  expect(card).toMatchObject({ kind: 'drift', missing: ['ReShade64.dll'], changed: ['winmm.dll'] })
  const markup = renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(StatusCard)))
  expect(markup).toContain('<button type="button" class="row-toggle" aria-expanded="false">Show files')
  // Only the news is announced; opening the list must not have the whole card read out again.
  expect(markup).toContain('<div role="alert"><h2>2 files need repair</h2><p>Something changed or removed what Lucent deployed.</p></div><button type="button" class="row-toggle"')
  const text = visibleText(createElement(StatusCard), core)
  expect(text).toContain('2 files need repair Something changed or removed what Lucent deployed. Show files')
  expect(text).not.toContain('winmm.dll')
  expect(text).not.toContain('ReShade64.dll')
  expect(text).not.toContain('Windows Security')
})

it('Versions lists every changelog line of a version, not only the first', async () => {
  const { platform, m } = await deployedOnRtx()
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  const text = visibleText(createElement(VersionsScreen), await reopen(platform))
  expect(text).toContain('OptiScaler 2 with sharper Neural Rendering.')
  expect(text).toContain('Drops the example shader.')
})
