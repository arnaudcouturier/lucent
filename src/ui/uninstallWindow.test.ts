// What Settings → Apps' uninstall window says, rendered to static markup against a real core on the fake platform.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { createCore, type Core } from '../core/core'
import { createFakePlatform, DEFAULT_ENV, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { CoreContext } from './useCore'
import { UninstallWindow } from './UninstallWindow'

const ROOT = 'C:\\Games\\XIV'
const DATA = `${DEFAULT_ENV.LocalAppData}\\Lucent`
const INSTALLED_EXE = `${DATA}\\Lucent.exe`

const markup = (core: Core) => renderToStaticMarkup(createElement(CoreContext.Provider, { value: core }, createElement(UninstallWindow)))
const visibleText = (core: Core) => markup(core).replace(/<wbr\/>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const uninstallButton = (core: Core) => /<button class="btn is-danger"[^>]*>/.exec(markup(core))?.[0] ?? ''

async function openFromSettings(m: Machine, platform: FakePlatform) {
  m.exePath = INSTALLED_EXE
  m.headlessMode = 'uninstall'
  const core = createCore(platform)
  await core.openAppUninstall()
  return core
}

async function deployed() {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  return { m, platform }
}

it('says Lucent is open in another window and keeps Uninstall unavailable until it closes', async () => {
  const { m, platform } = await deployed()
  m.processes = [INSTALLED_EXE]
  const core = await openFromSettings(m, platform)
  expect(visibleText(core)).toContain('Lucent is open in another window. Close it first, then uninstall.')
  expect(uninstallButton(core)).toContain('disabled')
  m.processes = []
  await core.refreshLucentElsewhere()
  expect(visibleText(core)).not.toContain('open in another window')
  expect(uninstallButton(core)).not.toContain('disabled')
})

it('names the folder of copies that goes with Lucent', async () => {
  const { m, platform } = await deployed()
  await platform.writeText(`${DATA}\\Backups\\XIV - Reset 2026-10-20T10-00-00-000\\game\\ReShade.ini`, '[GENERAL]\n')
  const core = await openFromSettings(m, platform)
  expect(visibleText(core)).toContain(`That includes the copies of files Lucent replaced in your game folder, in ${DATA}\\Backups . Move them elsewhere first to keep them.`)
})
