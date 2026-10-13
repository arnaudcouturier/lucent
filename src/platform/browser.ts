// Dev mode in a browser: the fake Platform on a named machine (`?machine=steam`), with the folder
// picker as a prompt so the flow can be clicked through. `?uninstall` opens the Settings → Apps uninstall window.
import type { Platform } from '../core/platform'
import { createFakePlatform } from './fake'
import { MACHINES, type MachineName } from './fixtures'

export function createBrowserPlatform(machineName: string | null, uninstall = false): Platform {
  const name: MachineName = machineName && machineName in MACHINES ? (machineName as MachineName) : 'steam'
  const fake = createFakePlatform({ ...MACHINES[name], headlessMode: uninstall ? 'uninstall' : null })
  return { ...fake, pickFolder: async ({ title }) => window.prompt(`${title} (a path on the fake machine)`) || null }
}
