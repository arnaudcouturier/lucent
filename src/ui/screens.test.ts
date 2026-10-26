// What the screens say, rendered to static markup against a real core on the fake platform. Effects, focus and layout
// need a browser; these tests cover the text and the accessible names, which a regression there would silently drop.
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createCore, type Core } from '../core/core'
import { createFakePlatform, DEFAULT_ENV, type FakePlatform, type Machine } from '../platform/fake'
import { existingSetup, fixtureContentHost, graphicsCard, MACHINES, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { CoreContext } from './useCore'
import { DoneScreen, Keys, ReviewScreen, StatusCard } from './DeploymentScreens'
import { ProfileScreen } from './Profiles'
import { SettingsScreen } from './MainScreens'
import { VersionsScreen } from './VersionsScreen'
import { LogsScreen } from './LogsScreen'
import { UninstallWindow } from './UninstallWindow'
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

describe('Open folder sits beside the folders that exist now, and only those', () => {
  const markupOf = (element: ReactElement, core: Core) => renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, element))
  const OPEN = '<button type="button" class="btn is-ghost open-folder" aria-label="Open folder" title="Open in File Explorer">'
  const openButtons = (markup: string) => markup.match(/aria-label="Open folder"/g)?.length ?? 0

  it('in Settings, right after the game folder’s last name, in the wrapper that keeps them on one line', async () => {
    const { platform } = await deployedOnRtx()
    const markup = markupOf(createElement(SettingsScreen), await reopen(platform))
    expect(openButtons(markup)).toBe(1)
    expect(markup).toMatch(new RegExp(`<div class="card settings-folder"><div><span class="folder-path"><span class="mono path [^"]*">C:.*\\\\<wbr/>XIV</span>${OPEN}`))
  })

  it('on Logs, beside Copy, for Lucent’s own log', async () => {
    const { platform } = await deployedOnRtx()
    const markup = markupOf(createElement(LogsScreen), await reopen(platform))
    expect(openButtons(markup)).toBe(1)
    expect(markup).toMatch(/<div class="terminal-actions"><button type="button" class="btn is-ghost open-folder terminal-copy" aria-label="Open folder" title="Open in File Explorer">.*Open folder<\/button><button class="btn is-ghost terminal-copy"/)
  })

  it('in the uninstall window, after the folder of copies it names', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), existingSetup(ROOT, 'reshade'))
    const platform = createFakePlatform(m)
    const deployed = createCore(platform)
    await deployed.scan()
    await deployed.review()
    await deployed.deploy()
    deployed.finish()
    // A vanilla uninstall leaves the originals out and keeps their copies.
    await deployed.uninstall(false)
    m.exePath = `${DEFAULT_ENV.LocalAppData}\\Lucent\\Lucent.exe`
    m.headlessMode = 'uninstall'
    const core = createCore(platform)
    await core.openAppUninstall()
    const markup = markupOf(createElement(UninstallWindow), core)
    expect(openButtons(markup)).toBe(1)
    expect(markup).toContain(`\\<wbr/>Backups</span>${OPEN}`)
    expect(markup).toContain('<span class="folder-path"><span class="mono path ">C:')
    expect(visibleText(createElement(UninstallWindow), core)).toContain(`in ${DEFAULT_ENV.LocalAppData}\\Lucent\\Backups . Move them elsewhere first to keep them.`)
  })

  it('not beside a folder that doesn’t exist yet, such as the one Reset backs up to', async () => {
    const { platform } = await deployedOnRtx()
    const core = await reopen(platform)
    await core.resetSetup()
    await core.review()
    const markup = markupOf(createElement(ReviewScreen), core)
    expect(markup).toContain('Your current config files will be backed up first at')
    expect(openButtons(markup)).toBe(0)
  })
})

describe('Review warns when a drive looks too full, and installs anyway', () => {
  const MB = 1024 ** 2
  const GB = 1024 ** 3
  const reviewOn = async (game: string, freeSpace: Record<string, number | null>) => {
    const core = createCore(createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(game), xivLauncher(game), { freeSpace })))
    await core.scan()
    await core.review()
    return core
  }
  /** The same core, showing a warning a real plan of this size would give. */
  const showing = (core: Core, spaceWarning: NonNullable<ReturnType<Core['getState']>['spaceWarning']>): Core => {
    const state = { ...core.getState(), spaceWarning }
    return { ...core, getState: () => state }
  }

  it('says how much the drive needs and has, under the summary, with Install still there', async () => {
    const core = await reviewOn(ROOT, { 'C:': 10 * MB })
    const markup = renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(ReviewScreen)))
    expect(markup).toMatch(/<\/dl><p class="callout space-warning" role="status"><svg[^>]*lucide-triangle-alert/)
    const text = visibleText(createElement(ReviewScreen), core)
    // 64 MB of margin and a few bytes of fixture content, rounded up.
    expect(text).toContain('This needs about 64.1 MB free on C: and there is 10.0 MB. If the disk fills up, Lucent stops and puts everything back.')
    expect(text).toContain('Install')
    expect(visibleText(createElement(ReviewScreen), showing(core, [{ drive: 'C:', needed: Math.round(1.35 * GB), free: Math.round(1.15 * GB) }])))
      .toContain('This needs about 1.4 GB free on C: and there is 1.1 GB.')
    // Figures that would round alike: the need rounds up and the free space down.
    expect(visibleText(createElement(ReviewScreen), showing(core, [{ drive: 'C:', needed: Math.round(1.41 * GB), free: Math.round(1.39 * GB) }])))
      .toContain('This needs about 1.5 GB free on C: and there is 1.3 GB.')
  })

  it('gives each short drive its own line', async () => {
    const core = await reviewOn('D:\\Games\\XIV', { 'C:': 2 * MB, 'D:': 3 * MB })
    const markup = renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(ReviewScreen)))
    expect(markup).toContain('This needs about 64.1 MB free on C: and there is 2.0 MB.<br/>This needs about 64.1 MB free on D: and there is 3.0 MB.<br/>If the disk fills up')
  })

  it('shows nothing when every drive has room', async () => {
    const core = await reviewOn(ROOT, {})
    expect(visibleText(createElement(ReviewScreen), core)).not.toContain('This needs about')
    expect(renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(ReviewScreen)))).not.toContain('space-warning')
  })
})

it('Versions lists every changelog line of a version, not only the first', async () => {
  const { platform, m } = await deployedOnRtx()
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  const text = visibleText(createElement(VersionsScreen), await reopen(platform))
  expect(text).toContain('OptiScaler 2 with sharper Neural Rendering.')
  expect(text).toContain('Drops the example shader.')
})

it('Review says why Install waits above the summary, not under the pinned footer where it was found in the real window', async () => {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), { gameRunning: true })
  const core = createCore(createFakePlatform(m))
  await core.scan()
  await core.review()
  const text = visibleText(createElement(ReviewScreen), core)
  expect(text).toContain('XIV is running')
  expect(text.indexOf('XIV is running')).toBeLessThan(text.indexOf('Files backed up'))
})

describe('the UI mode and DLSS-G preset choices', () => {
  const RTX_3080 = graphicsCard('NVIDIA GeForce RTX 3080')
  const profileStep = async (screen = MACHINES.settings240Hdr, card: Machine = graphicsCard()) => {
    const platform = createFakePlatform(machine(screen, card))
    const core = createCore(platform)
    await core.scan()
    await core.continueSetup()
    return core
  }
  const markup = (element: ReactElement, core: Core) => renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, element))

  it('shows both choices on the Graphics step, after HDR, with their descriptions and the Experimental tag', async () => {
    const core = await profileStep()
    const text = visibleText(createElement(ProfileScreen), core)
    expect(text.indexOf('HDR')).toBeLessThan(text.indexOf('UI mode'))
    expect(text.indexOf('UI mode')).toBeLessThan(text.indexOf('DLSS-G preset'))
    for (const label of ['Off', 'Recomposition', 'UI-free', 'Auto', 'Preset A', 'Preset B', 'Preset C']) expect(text).toContain(label)
    expect(text).toContain('Gives frame generation the scene and the interface as separate images')
    expect(text).toContain('The driver and NVIDIA’s runtime decide.')
    expect(text.slice(text.indexOf('UI mode'), text.indexOf('DLSS-G preset'))).toContain('Experimental')
  })

  it('greys out Preset A and C with the reason while the UI mode is Recomposition, and UI-free while HDR is on', async () => {
    const core = await profileStep()
    const html = markup(createElement(ProfileScreen), core)
    const disabled = (value: string, page = html) => new RegExp(`<input(?=[^>]*disabled)[^>]*value="${value}"`).test(page)
    expect(disabled('a')).toBe(true)
    expect(disabled('c')).toBe(true)
    expect(disabled('b')).toBe(false)
    expect(disabled('auto')).toBe(false)
    // HDR is on by default on this panel, so UI-free is greyed out too.
    expect(disabled('ui-free')).toBe(true)
    expect(visibleText(createElement(ProfileScreen), core)).toContain('Preset A and C turn UI recomposition off. Set UI mode to Off or UI-free to use them.')
    expect(visibleText(createElement(ProfileScreen), core)).toContain('UI-free isn’t supported with HDR yet.')

    core.selectSettingChoice('ui-mode', 'off')
    const open = markup(createElement(ProfileScreen), core)
    expect(disabled('c', open)).toBe(false)
    expect(visibleText(createElement(ProfileScreen), core)).not.toContain('Preset A and C turn UI recomposition off')
  })

  it('hides both while frame generation is Off, and from a card without DLSS frame generation', async () => {
    const core = await profileStep()
    core.selectFrameGenerationMode('off')
    expect(visibleText(createElement(ProfileScreen), core)).not.toContain('DLSS-G preset')
    expect(visibleText(createElement(ProfileScreen), core)).not.toContain('UI mode')
    const rtx30 = await profileStep(MACHINES.settings60Sdr, RTX_3080)
    rtx30.selectFrameGenerationMode('2x')
    expect(visibleText(createElement(ProfileScreen), rtx30)).not.toContain('DLSS-G preset')
  })

  it('names the picks on Review and on Done', async () => {
    const core = await profileStep()
    core.selectSettingChoice('ui-mode', 'off')
    core.selectSettingChoice('dlssg-preset', 'b')
    await core.review()
    const review = visibleText(createElement(ReviewScreen), core)
    expect(review).toContain('UI mode Off')
    expect(review).toContain('DLSS-G preset Preset B')
    await core.deploy()
    expect(core.getState().error).toBeNull()
    const done = visibleText(createElement(DoneScreen), core)
    expect(done).toContain('UI mode Off')
    expect(done).toContain('DLSS-G preset Preset B')
  })

  it('leaves them off Review when frame generation is Off', async () => {
    const core = await profileStep()
    core.selectFrameGenerationMode('off')
    await core.review()
    const review = visibleText(createElement(ReviewScreen), core)
    expect(review).not.toContain('UI mode')
    expect(review).not.toContain('DLSS-G preset')
  })
})

describe('Settings’ Storage card', () => {
  async function storageCore(...extra: Machine[]) {
    const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), ...extra)
    const platform = createFakePlatform(m)
    const deployed = createCore(platform)
    await deployed.scan()
    await deployed.review()
    await deployed.deploy()
    deployed.finish()
    const core = await reopen(platform)
    await core.refreshStorage()
    return { platform, core }
  }
  // A button's icon is tags only, so the match can't run on from one button into another.
  const ICON = '(?:<svg[^>]*>(?:<[^>]*>)*?</svg>)?'
  const buttonsNamed = (markup: string, name: string, attributes = '') => markup.match(new RegExp(`<button[^>]*${attributes}[^>]*>${ICON}${name}</button>`, 'g')) ?? []

  it('shows the cache’s size with a Clear… button, and no Backups row while there are no copies', async () => {
    const { core } = await storageCore()
    const text = visibleText(createElement(SettingsScreen), core)
    expect(text).toMatch(/Storage Cache .*\\Lucent\\cache \d+ files? · [\d.]+ [KM]?B\. Content Lucent downloaded, kept so an install, update or repair doesn’t download it again\./)
    expect(text).not.toContain('Backups')
    expect(buttonsNamed(renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(SettingsScreen))), 'Clear…')).toHaveLength(1)
  })

  it('shows a Backups row with its folders and size beside the Cache row once Lucent has replaced a file', async () => {
    const { core } = await storageCore(existingSetup(ROOT, 'reshade'))
    const text = visibleText(createElement(SettingsScreen), core)
    expect(text).toMatch(/Backups .*\\Lucent\\Backups 1 folder · [\d.]+ [KM]?B\. Copies of the files Lucent replaced/)
    expect(buttonsNamed(renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(SettingsScreen))), 'Clear…')).toHaveLength(2)
    // The row moved out of Game folder: it sits after the Storage heading, not before it.
    expect(text.indexOf('Backups')).toBeGreaterThan(text.indexOf('Storage'))
  })

  it('says a folder can’t be read, and leaves its Clear… off, when Lucent can’t list it', async () => {
    const { platform, core } = await storageCore(existingSetup(ROOT, 'reshade'))
    const list = platform.listFiles.bind(platform)
    platform.listFiles = async (root) => { if (root.endsWith('\\Lucent\\Backups')) throw new Error('A link to a drive that is gone'); return list(root) }
    await core.refreshStorage()
    const markup = renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(SettingsScreen)))
    expect(visibleText(createElement(SettingsScreen), core)).toMatch(/Backups .*Lucent\\Backups Lucent can’t read this folder, so it can’t show its size or clear it\. Copies of the files Lucent replaced/)
    // The Cache row still clears; the Backups row has nothing it can clear.
    expect(buttonsNamed(markup, 'Clear…', 'disabled=""')).toHaveLength(1)
    expect(buttonsNamed(markup, 'Clear…')).toHaveLength(2)
  })

  it('leaves both Clear… buttons off while Lucent is busy, and on otherwise', async () => {
    const { core } = await storageCore(existingSetup(ROOT, 'reshade'))
    const markup = renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(SettingsScreen)))
    expect(buttonsNamed(markup, 'Clear…', 'disabled=""')).toHaveLength(0)
    const busy = { ...core, getState: () => ({ ...core.getState(), busy: true }) } as Core
    const busyMarkup = renderToStaticMarkup(createElement(CoreContext.Provider, { value: busy }, createElement(SettingsScreen)))
    expect(buttonsNamed(busyMarkup, 'Clear…', 'disabled=""')).toHaveLength(2)
  })
})

describe('Settings’ After a game patch card', () => {
  const INI = `${ROOT}\\game\\OptiScaler.ini`
  async function patchCore(withKey: boolean) {
    const { platform, m } = await deployedOnRtx()
    if (withKey) await platform.writeText(INI, `${await platform.readText(INI)}\r\n[FFXIV]\r\nFfxivUnknownBuildHooks = auto\r\n`)
    const core = await reopen(platform)
    await core.refreshPatchSwitch()
    return { core, m }
  }
  const markupOf = (core: Core) => renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(SettingsScreen)))
  const switchInput = (markup: string) => /<input type="checkbox" role="switch"[^>]*>/.exec(markup.slice(markup.indexOf('aria-label="After a game patch"')))![0]

  it('offers the switch with its text, off while the key reads auto', async () => {
    const { core } = await patchCore(true)
    const text = visibleText(createElement(SettingsScreen), core)
    expect(text).toContain('After a game patch Keep game-code features running after an XIV patch (experimental) OptiScaler-FFXIV finds the game’s code addresses itself. After a patch, features that read the game’s code stay off unless this is on and every address is found. Takes effect the next time XIV starts.')
    expect(switchInput(markupOf(core))).not.toMatch(/checked|disabled/)
  })

  it('shows it on once the key says true', async () => {
    const { core } = await patchCore(true)
    await core.setUnknownBuildHooks(true)
    expect(switchInput(markupOf(core))).toMatch(/checked/)
  })

  it('is off and says why when the ini predates the setting', async () => {
    const { core } = await patchCore(false)
    expect(visibleText(createElement(SettingsScreen), core)).toContain('Update to the newest content first.')
    expect(switchInput(markupOf(core))).toMatch(/disabled/)
  })

  it('waits, with the reason, while XIV runs', async () => {
    const { core, m } = await patchCore(true)
    m.gameRunning = true
    await core.refreshGameRunning()
    expect(visibleText(createElement(SettingsScreen), core)).toContain('XIV is running. Changes wait until you close the game.')
    expect(switchInput(markupOf(core))).toMatch(/disabled/)
  })

  it('has no card before the ini has been read', async () => {
    const { platform } = await deployedOnRtx()
    const core = await reopen(platform)
    expect(visibleText(createElement(SettingsScreen), core)).not.toContain('After a game patch')
  })
})
