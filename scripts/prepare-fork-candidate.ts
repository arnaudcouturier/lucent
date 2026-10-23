// Prepares the local dry-run candidate that moves OptiScaler to the maintainer's fork and the NVIDIA runtimes to 310.9.16:
// the fork's release zip, the Streamline SDK and the two Neural Rendering runtimes in, the previous version's ReShade
// material and tier controls kept. Every input is hash-checked against `recipe.json` before anything is staged, and nothing
// is published. Writes publish.json, manifest.json, files/ (for LUCENT_DEV_FILES) and provenance.json under --output.
//
//   npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json `
//     --recipe content\candidates\2026.10.19\recipe.json --fork-zip <OptiScaler-FFXIV zip> --streamline-zip <Streamline SDK zip> `
//     --nr-folder C:\Users\arnaudc\Desktop\nvngx_dlssnr --tuned-ini <the maintainer's saved OptiScaler.ini> --output C:\LucentContent\candidate-2026.10.19
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { Component, FrameGenerationOption, SettingChoice, Step } from '../src/shared/manifest'
import { runCommand } from './command'
import { prepareOutputFolder } from './candidate-output'
import { mergeIni, type IniKey, type IniOverride } from './candidate-ini'
import { applyReshadeStyle, type EmberPalette } from './ember-style'
import { publishContent, type PublishInput } from './publish-content'

interface Hashed { sha256: string }
interface ForkRecipe {
  basedOnContent: string
  id: string
  channel: 'stable' | 'beta'
  minAppVersion: string
  changelog: string[]
  fork: { component: string; tag: string; commit: string; zipName: string; zipSha256: string; winmmSha256: string; iniSha256: string }
  streamline: { component: string; tag: string; zipName: string; zipSha256: string; files: (Hashed & { from: string; to: string })[] }
  neuralRendering: Record<string, Hashed & { component: string; file: string; size: number }>
  newComponents: Component[]
  /** The maintainer's own saved OptiScaler.ini: its values are carried over the fork's defaults. */
  tunedIni: { sha256: string; description: string }
  /** Saved values that stay at the fork's default although the ini sets them, each with why. */
  iniNotCarried: { section: string; key: string; reason: string }[]
  /** Optional: writes the Ember palette (the fork's own dump, content/ember/palette.json) over the [STYLE] of the base ReShade.ini, so ReShade's menu matches OptiScaler's. */
  reshadeStyle?: { palette: string; baseIniSha256: string }
  /** Optional ReShade.ini keys the install sets after it copies the file; a value may name `{Pictures}`, which the app resolves to the player's Pictures folder. */
  reshadeSettings?: { section: string; key: string; value: string }[]
  /** Optional folders the mods fill while the game runs, which Uninstall removes with everything in them (relative to the game folder). */
  generatedFolders?: string[]
  /**
   * Optional first-install choices for both tiers (the DLSS-G preset, the UI mode). Their keys are left out of `chosenAtInstall` on purpose:
   * the base ini keeps the maintainer's values, so an app that predates the field installs what the content shipped before.
   */
  settingChoices?: SettingChoice[]
  iniOverrides: IniOverride[]
}
type PublishTier = PublishInput['tiers'][string]

const sevenZip = join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe')
const REPLACED_COMPONENTS = new Set(['OptiScaler', 'OptiScaler winmm.dll'])
const RTX_40 = 'RTX\\s?40[0-9]{2}'
const RTX_50 = 'RTX\\s?50[0-9]{2}'

const sha256 = (path: string) => new Promise<string>((done, fail) => {
  const hash = createHash('sha256')
  createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', fail).on('end', () => done(hash.digest('hex')))
})
async function verified(path: string, expected: string, what: string) {
  const actual = await sha256(path)
  if (actual !== expected) throw new Error(`${what} has SHA-256 ${actual}, not the reviewed ${expected}.`)
}
async function files(root: string, prefix = ''): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...await files(root, path))
    else found.push(path)
  }
  return found
}
async function stage(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

/** The RTX 40 frame generation options, for RTX 50: native multi-frame generation, so no unlock, and nothing here has been played. */
function rtx50FrameGeneration(options: FrameGenerationOption[]): FrameGenerationOption[] {
  return options.filter((o) => !o.gpuNamePatterns || o.gpuNamePatterns.includes(RTX_40)).map((o) => {
    if (!o.gpuNamePatterns) return structuredClone(o)
    const { hdrSettings: _hdr, ...rest } = structuredClone(o)
    return {
      ...rest, gpuNamePatterns: [RTX_50], experimental: true,
      settings: rest.settings.map((s) => s.section === 'DLSSG' && s.key === 'AdaMfgUnlock' ? { ...s, value: 'false' } : s),
    }
  })
}

async function main() {
  const { values } = parseArgs({ options: {
    base: { type: 'string' }, recipe: { type: 'string' }, 'fork-zip': { type: 'string' }, 'streamline-zip': { type: 'string' },
    'nr-folder': { type: 'string' }, 'tuned-ini': { type: 'string' }, output: { type: 'string' }, manifest: { type: 'string', default: 'manifest.json' },
  } })
  const [basePath, recipePath, forkZip, streamlineZip, nrFolder, tunedIniPath, outputRoot, manifestPath] =
    (['base', 'recipe', 'fork-zip', 'streamline-zip', 'nr-folder', 'tuned-ini', 'output', 'manifest'] as const).map((name) => {
      if (!values[name]) throw new Error(`Missing --${name}.`)
      return resolve(values[name]!)
    })
  const recipe = JSON.parse(await readFile(recipePath, 'utf8')) as ForkRecipe
  const input = JSON.parse((await readFile(basePath, 'utf8')).replace(/^\uFEFF/, '')) as PublishInput
  if (input.id !== recipe.basedOnContent) throw new Error(`Expected the input for ${recipe.basedOnContent}; found ${input.id}.`)
  const baseTier = input.tiers['rtx-30-40']
  if (!baseTier || Object.keys(input.tiers).length !== 1) throw new Error('Expected only the rtx-30-40 tier in the base input.')

  await verified(forkZip, recipe.fork.zipSha256, forkZip)
  await verified(streamlineZip, recipe.streamline.zipSha256, streamlineZip)
  for (const [tier, nr] of Object.entries(recipe.neuralRendering)) await verified(join(nrFolder, nr.file), nr.sha256, `${tier} Neural Rendering runtime`)

  // Everything the build reads from here on, which emptying the output folder must never take with it.
  const baseSources = baseTier.sources.flatMap((s) => [s.folder, s.archive].filter((path): path is string => !!path))
  await prepareOutputFolder(outputRoot, [
    basePath, recipePath, forkZip, streamlineZip, nrFolder, tunedIniPath, manifestPath,
    ...baseSources.flatMap((path) => [resolve(dirname(basePath), path), resolve(path)]),
    ...(recipe.reshadeStyle ? [resolve(dirname(recipePath), recipe.reshadeStyle.palette)] : []),
  ])
  const sources = join(outputRoot, 'sources')
  await mkdir(sources, { recursive: true })

  // The fork's package: every file must match the package's own SHA256SUMS.txt, and the two it names in the release notes.
  const forkRoot = join(sources, 'optiscaler-ffxiv')
  await runCommand(sevenZip, ['x', '-y', `-o${forkRoot}`, '--', forkZip])
  const sums = (await readFile(join(forkRoot, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/).map((l) => /^([0-9a-f]{64}) {2}(.+)$/.exec(l)!)
  for (const [, hash, path] of sums) await verified(join(forkRoot, path), hash, `${path} in the fork package`)
  await verified(join(forkRoot, 'winmm.dll'), recipe.fork.winmmSha256, 'winmm.dll in the fork package')
  await verified(join(forkRoot, 'OptiScaler.ini'), recipe.fork.iniSha256, 'OptiScaler.ini in the fork package')
  const licences = (await files(forkRoot, 'Licenses')).map((path) => path.slice('Licenses/'.length))

  // The Streamline SDK: only the reviewed files, placed at their game-folder paths.
  const sdkRoot = join(sources, 'streamline-sdk')
  await runCommand(sevenZip, ['x', '-y', `-o${sdkRoot}`, '--', streamlineZip, ...recipe.streamline.files.map((f) => f.from)])
  const streamlineRoot = join(sources, 'streamline')
  for (const f of recipe.streamline.files) {
    await verified(join(sdkRoot, f.from), f.sha256, `${f.from} in the Streamline SDK`)
    await stage(join(sdkRoot, f.from), join(streamlineRoot, f.to))
  }

  // The ini: the fork's, the maintainer's saved values over it, then the menu theme. What the player picks while installing is
  // written by the install from the tier's controls, so those keys, and the ones listed in the recipe, keep the fork's default.
  await verified(tunedIniPath, recipe.tunedIni.sha256, "The maintainer's saved OptiScaler.ini")
  const controls = baseTier.neuralRenderingControls
  const chosenAtInstall: IniKey[] = [
    ...(baseTier.recipe ?? []).filter((step) => step.kind === 'ini_set'),
    ...(baseTier.frameGenerationOptions ?? []).flatMap((option) => [...option.settings, ...(option.hdrSettings ?? [])]),
    ...(baseTier.hdrOptions ?? []).flatMap((option) => option.settings),
    ...(baseTier.screenDerivedSettings ?? []),
    ...(baseTier.mfgUnlock?.settings ?? []),
    ...(controls ? [controls.presetKey, controls.passesKey, controls.scaleKey, controls.spatialCompression.key, controls.residualFg.key] : []),
  ]
  const merge = mergeIni(await readFile(join(forkRoot, 'OptiScaler.ini'), 'utf8'), await readFile(tunedIniPath, 'utf8'), recipe.iniOverrides, [...chosenAtInstall, ...recipe.iniNotCarried])
  const configRoot = join(sources, 'config')
  await mkdir(configRoot, { recursive: true })
  await writeFile(join(configRoot, 'OptiScaler.ini'), merge.text, 'utf8')
  await stage(tunedIniPath, join(sources, 'saved-ini', 'OptiScaler.ini'))

  // Components: the fork replaces both OptiScaler entries.
  input.components = [...recipe.newComponents, ...input.components.filter((c) => !REPLACED_COMPONENTS.has(c.name))]
  const keep = input.components.map((c) => c.name)
  const retained = baseTier.sources.filter((s) => !REPLACED_COMPONENTS.has(s.component))
  if (retained.some((s) => !keep.includes(s.component))) throw new Error('A retained source names a component that is gone.')

  // A few ReShade licence files sat in the old OptiScaler source folder; carry exactly those over, under the pack they belong to.
  const exists = (path: string) => access(path).then(() => true, () => false)
  const carriedRoot = join(sources, 'carried-licences')
  const carried: string[] = []
  for (const step of baseTier.recipe!) {
    if (step.kind !== 'copy' || step.when !== 'reshade') continue
    let found = false
    for (const source of retained) found ||= !!source.folder && await exists(join(source.folder, step.file))
    if (found) continue
    const old = baseTier.sources.find((s) => REPLACED_COMPONENTS.has(s.component) && s.folder && existsSync(join(s.folder, step.file)))
    if (!old?.folder) throw new Error(`No base source holds ${step.file}.`)
    await stage(join(old.folder, step.file), join(carriedRoot, step.file))
    carried.push(step.file)
  }
  // ReShade's menu in the Ember palette: the base ReShade.ini with its [STYLE] rewritten from the fork's palette dump.
  const reshadeStyleRoot = join(sources, 'reshade-style')
  let reshadeStyleReport: { changed: string[]; palette: string } | null = null
  if (recipe.reshadeStyle) {
    const palette = JSON.parse(await readFile(resolve(dirname(recipePath), recipe.reshadeStyle.palette), 'utf8')) as EmberPalette
    const base = (await Promise.all(baseTier.sources.map(async (source) => {
      const path = source.folder && join(source.folder, 'ReShade.ini')
      try { return path && await sha256(path) === recipe.reshadeStyle!.baseIniSha256 ? path : null } catch { return null }
    }))).find(Boolean)
    if (!base) throw new Error(`No base source holds the ReShade.ini ${recipe.reshadeStyle.baseIniSha256}.`)
    const styled = applyReshadeStyle(await readFile(base, 'utf8'), palette)
    if (styled.unmapped.length) throw new Error(`The ReShade.ini has no [STYLE] key for: ${styled.unmapped.join(', ')}.`)
    await mkdir(reshadeStyleRoot, { recursive: true })
    await writeFile(join(reshadeStyleRoot, 'ReShade.ini'), styled.text, 'utf8')
    reshadeStyleReport = { changed: styled.changed, palette: recipe.reshadeStyle.palette }
  }
  const copy = (file: string, to = file): Step => ({ kind: 'copy', file, to })
  const optiscaler: Step[] = [
    ...licences.map((name) => copy(`Licenses/${name}`, `licenses/${name}`)),
    copy('NOTICE.txt', 'licenses/OptiScaler-FFXIV_NOTICE.txt'),
    ...recipe.streamline.files.filter((f) => f.to.startsWith('licenses/') || f.to.endsWith('.license.txt')).map((f) => copy(f.to)),
    copy('nvngx.dll_dlssnr.dll'),
    ...(await files(forkRoot, 'OptiScaler')).map((path) => copy(path)),
    copy('OptiScaler/libxell.dll'),
    ...recipe.streamline.files.filter((f) => f.to.endsWith('.dll')).map((f) => copy(f.to)),
    copy('OptiScaler.ini'), copy('winmm.dll'), copy('nvngx_dlssnr.dll'),
    ...baseTier.recipe!.filter((s) => s.kind === 'ini_set'),
  ]
  const reshade = baseTier.recipe!.filter((s) => s.kind !== 'ini_set' && s.when === 'reshade')
  // What the previous version copied for every player and this one no longer ships; the update deletes these, so the report names each.
  const dropped = baseTier.recipe!.flatMap((s) => s.kind === 'copy' && !s.when && !optiscaler.some((o) => o.kind === 'copy' && o.to.toLowerCase() === s.to.toLowerCase()) ? [s.to] : [])

  // The runtimes are copied under the output so the candidate no longer depends on where they were handed over.
  const nrRoots: Record<string, string> = {}
  for (const [id, nr] of Object.entries(recipe.neuralRendering)) {
    nrRoots[id] = join(sources, 'neural-rendering', id)
    await stage(join(nrFolder, nr.file), join(nrRoots[id], 'nvngx_dlssnr.dll'))
  }
  const reshadeSettings: Step[] = (recipe.reshadeSettings ?? []).map((s) => ({ kind: 'ini_set', file: 'ReShade.ini', section: s.section, key: s.key, value: s.value, when: 'reshade' }))
  const tier = (id: string, nrComponent: { component: string }, base: PublishTier): PublishTier => ({
    ...base,
    generatedFiles: [...(base.generatedFiles ?? []), ...(recipe.generatedFolders ?? []).map((path) => ({ path }))],
    ...(recipe.settingChoices ? { settingChoices: recipe.settingChoices } : {}),
    sources: [
      { folder: forkRoot, component: recipe.fork.component },
      ...retained,
      ...(carried.length ? [{ folder: carriedRoot, component: 'Alive NEXT' }] : []),
      ...(recipe.reshadeStyle ? [{ folder: reshadeStyleRoot, component: 'ReShade', when: 'reshade' as const }] : []),
      { folder: streamlineRoot, component: recipe.streamline.component },
      { folder: nrRoots[id], component: nrComponent.component },
      { folder: configRoot, component: recipe.fork.component },
    ],
    recipe: [...optiscaler, ...reshade, ...reshadeSettings],
  })
  const nr = recipe.neuralRendering
  const modern = tier('rtx-20-30-40', nr['rtx-20-30-40'], baseTier)
  const blackwell = tier('rtx-50', nr['rtx-50'], { ...baseTier, frameGenerationOptions: rtx50FrameGeneration(baseTier.frameGenerationOptions ?? []) })
  delete blackwell.mfgUnlock
  input.tiers = { 'rtx-20-30-40': modern, 'rtx-50': blackwell }
  input.id = recipe.id
  input.channel = recipe.channel
  input.minAppVersion = recipe.minAppVersion
  input.changelog = [...recipe.changelog]

  const publishInputPath = join(outputRoot, 'publish.json')
  await writeFile(publishInputPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8')
  const { manifestText, warnings } = await publishContent(publishInputPath, { manifestPath, dryRun: true, dryRunFilesDirectory: join(outputRoot, 'files') })
  for (const warning of warnings) console.warn(`Warning: ${warning}`)
  await writeFile(join(outputRoot, 'manifest.json'), manifestText, 'utf8')
  await writeFile(join(outputRoot, 'provenance.json'), `${JSON.stringify({
    candidate: recipe.id,
    fork: { tag: recipe.fork.tag, commit: recipe.fork.commit, zipSha256: recipe.fork.zipSha256, packageSums: sums.length },
    streamline: { tag: recipe.streamline.tag, zipSha256: recipe.streamline.zipSha256, files: recipe.streamline.files },
    neuralRendering: recipe.neuralRendering,
    savedIni: { sha256: recipe.tunedIni.sha256, carried: merge.carried, leftToTheInstall: merge.skipped, overridden: merge.overridden, lost: merge.lost },
    droppedFromPrevious: dropped,
    carriedLicences: carried,
    reshadeStyle: reshadeStyleReport,
    dryRun: true,
    remotePublicationPerformed: false,
  }, null, 2)}\n`, 'utf8')
  console.log(`Prepared local dry-run candidate ${recipe.id} at ${outputRoot}`)
  console.log(`Ini: ${merge.carried.length} saved values carried, ${merge.skipped.length} left to the install or the recipe, ${merge.overridden.length} overrides, ${merge.lost.length} saved values lost with keys the fork lacks.`)
  console.log(`Dropped from ${recipe.basedOnContent}: ${dropped.length} files.`)
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
