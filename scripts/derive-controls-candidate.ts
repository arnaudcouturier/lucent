// Derives the publisher input for a content version from the previous one's input: the same files and recipe, with the
// version's id, channel, minimum app, changelog and config rules replaced, the performance profiles dropped and the
// Neural Rendering controls and multi-frame unlock added. No file changes, so a publish reuses every published asset.
//
//   npx tsx scripts/derive-controls-candidate.ts --base C:\LucentContent\candidate-2026.10.15-final\publish.json \
//     --recipe content\candidates\2026.10.16\recipe.json --output C:\LucentContent\candidate-2026.10.16
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { IniSetting, MfgUnlock, NeuralRenderingControls } from '../src/shared/manifest'
import type { PublishInput } from './publish-content'

interface ControlsRecipe {
  basedOnContent: string
  id: string
  channel: 'stable' | 'beta'
  minAppVersion: string
  changelog: string[]
  configUpdateRules: { path: string; when?: 'reshade'; update: 'keep' | 'addMissingKeys' | 'replace'; rationale: string }[]
  /** Baseline values written after the files are copied, such as a key binding. */
  iniSettings?: IniSetting[]
  /** Files that replace the same game-folder path from the earlier sources, such as a rebuilt winmm.dll. Each is hash-checked. */
  replaceFiles?: { from: string; to: string; component: string; sha256: string }[]
  neuralRenderingControls: NeuralRenderingControls
  mfgUnlock: MfgUnlock
}

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const [basePath, recipePath, outputPath] = ['base', 'recipe', 'output'].map((name) => {
  const value = args.get(name)
  if (!value) throw new Error(`Missing --${name}.`)
  return resolve(value)
})
if (!isAbsolute(outputPath)) throw new Error('The output folder must be an absolute path.')

const recipe = JSON.parse(await readFile(recipePath, 'utf8')) as ControlsRecipe
const input = JSON.parse((await readFile(basePath, 'utf8')).replace(/^\uFEFF/, '')) as PublishInput
if (input.id !== recipe.basedOnContent) throw new Error(`Expected the input for ${recipe.basedOnContent}; found ${input.id}.`)
const tier = input.tiers['rtx-20-30-40']
if (!tier || Object.keys(input.tiers).length !== 1) throw new Error('Expected only the rtx-20-30-40 tier.')

input.id = recipe.id
input.channel = recipe.channel
input.minAppVersion = recipe.minAppVersion
input.changelog = [...recipe.changelog]
tier.ownedConfigs = tier.ownedConfigs.map((config) => {
  const rule = recipe.configUpdateRules.find((r) => r.path === config.path && r.when === config.when)
  if (!rule) throw new Error(`No update rule for ${config.path}.`)
  return { ...config, update: rule.update }
})
if (recipe.iniSettings?.length) {
  if (!tier.recipe) throw new Error('Expected an explicit recipe to add INI settings to.')
  tier.recipe = [...tier.recipe, ...recipe.iniSettings.map((setting) => ({ kind: 'ini_set' as const, ...setting }))]
}
for (const [index, replacement] of (recipe.replaceFiles ?? []).entries()) {
  const bytes = await readFile(replacement.from)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== replacement.sha256) throw new Error(`${replacement.from} has SHA-256 ${sha256}, not the reviewed ${replacement.sha256}.`)
  if (!input.components.some((component) => component.name === replacement.component)) throw new Error(`Unknown component: ${replacement.component}.`)
  const folder = join(outputPath, 'overlays', `replace-${index + 1}`)
  await mkdir(dirname(join(folder, replacement.to)), { recursive: true })
  await copyFile(replacement.from, join(folder, replacement.to))
  // The last source wins for a path, so the replacement comes after every earlier source.
  tier.sources.push({ folder, component: replacement.component })
}
delete tier.performanceProfiles
delete tier.performanceProfilesV2
tier.neuralRenderingControls = recipe.neuralRenderingControls
tier.mfgUnlock = recipe.mfgUnlock

await mkdir(outputPath, { recursive: true })
await writeFile(join(outputPath, 'publish.json'), `${JSON.stringify(input, null, 2)}\n`, 'utf8')
console.log(`Wrote ${join(outputPath, 'publish.json')} for content ${recipe.id}.`)
