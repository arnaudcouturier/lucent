import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishContent, type PublishInput } from './publish-content'
import type { Component, FrameGenerationOption, HdrOption, IniSetting, PerformanceProfile, ScreenDerivedSetting } from '../src/shared/manifest'

interface VendorComponent extends Component {
  key: string
  files: string[]
  versionEvidence: string
}
interface CandidateRecipe {
  basedOnContent: string
  id: string
  channel: 'stable' | 'beta'
  minAppVersion: string
  changelog: string[]
  vendorComponents: VendorComponent[]
  hotkeys: Record<string, string>
  screenDerivedSettings: ScreenDerivedSetting[]
  performanceProfilesV2: PerformanceProfile[]
  hdrOptions: HdrOption[]
  frameGeneration: {
    off: { provider: 'nofg'; gpuPatterns: string[]; experimental: boolean }
    rtx30: {
      provider: 'fsrfg'; gpuPatterns: string[]; experimental: boolean
      hdrProvider: 'xefg'; hdrXeFgUnlockMfg: false; hdrXeFgInterpolationCount: 1
      hdrXeFgMaxInterpolatedFrames: 1; hdrXeFgDynamicMfg: false; pending: string
    }
    rtx40: {
      provider: 'dlssg'; gpuPatterns: string[]; multipliers: string[]
      dynamicExperimentalPendingQa: boolean; adaUnlockMultipliers: string[]
    }
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const recipePath = join(repoRoot, 'content', 'candidates', '2026.10.15', 'recipe.json')
const manifestPath = join(repoRoot, 'manifest.json')
const expectedIntelHashes: Record<string, string> = {
  'OptiScaler/libxess_fg.dll': 'ec5e0c65e075570c6ede72618bb666d0be0c2e10b2ea9762c0fe8cb8e375ab27',
  'OptiScaler/libxell.dll': 'd2030dcd694fda8f2ec7e044b13e6db8f0b56d4ba9113a5efad334e3f3ded8c7',
  'licenses/XeSS_LICENSE.txt': '784be42c39a4a4d03cf85d88e15e59d75828fca773ce45b8dbfffbd7eaf208df',
}

const args = parseArgs(process.argv.slice(2))
await prepareCandidate(args.sourceRoot, args.outputRoot)

async function prepareCandidate(sourceRoot: string, outputRoot: string): Promise<void> {
  if (!isAbsolute(sourceRoot) || !isAbsolute(outputRoot)) throw new Error('Source and output roots must be absolute paths.')
  sourceRoot = resolve(sourceRoot)
  outputRoot = resolve(outputRoot)
  if (within(repoRoot, outputRoot)) throw new Error('The local candidate output must be outside the repository.')
  if (within(join(sourceRoot, 'tested'), outputRoot)) throw new Error('The candidate output must not be inside the original tested sources.')
  await requireDirectory(sourceRoot)
  await requireFile(join(sourceRoot, 'publish.json'))
  await requireFile(manifestPath)
  const recipe = JSON.parse(await readFile(recipePath, 'utf8')) as CandidateRecipe
  const input = JSON.parse((await readFile(join(sourceRoot, 'publish.json'), 'utf8')).replace(/^\uFEFF/, '')) as PublishInput
  if (input.id !== recipe.basedOnContent) throw new Error(`Expected source publish.json for ${recipe.basedOnContent}; found ${input.id}.`)
  const tierIds = Object.keys(input.tiers)
  if (tierIds.length !== 1 || tierIds[0] !== 'rtx-30-40') throw new Error(`Expected only the tested rtx-30-40 source tier; found ${tierIds.join(', ')}.`)
  if (input.tiers['rtx-30-40'].performanceProfilesV2) throw new Error('Source input already has V2 profiles; refusing to overwrite changed candidate data.')
  // mkdir without recursive intentionally refuses an existing candidate folder; an earlier result is preserved.
  await mkdir(outputRoot)
  const overlays = join(outputRoot, 'overlays')
  const configOverlay = join(overlays, 'config')
  const amdOverlay = join(overlays, 'amd')
  const intelOverlay = join(overlays, 'intel')
  await mkdir(overlays)
  await mkdir(configOverlay)
  await mkdir(amdOverlay)
  await mkdir(intelOverlay)
  const originalOptiScalerIni = join(sourceRoot, 'tested', 'optiscaler', 'OptiScaler.ini')
  await requireFile(originalOptiScalerIni)
  const sourceIniText = await readFile(originalOptiScalerIni, 'utf8')
  const candidateIni = rewriteCandidateIni(sourceIniText, recipe.hotkeys)
  await writeFile(join(configOverlay, 'OptiScaler.ini'), candidateIni, 'utf8')

  const vendorProvenance: Array<Record<string, unknown>> = []
  for (const vendor of recipe.vendorComponents) {
    const targetRoot = vendor.key === 'amd' ? amdOverlay : vendor.key === 'intel' ? intelOverlay : null
    if (!targetRoot) throw new Error(`Unknown vendor overlay: ${vendor.key}`)
    const copiedFiles: Array<{ path: string; sha256: string; size: number; expectedOfficialMatch?: boolean }> = []
    for (const gamePath of vendor.files) {
      const sourcePath = join(sourceRoot, 'tested', 'optiscaler', ...gamePath.split('/'))
      const targetPath = join(targetRoot, ...gamePath.split('/'))
      await requireFile(sourcePath)
      await mkdir(dirname(targetPath), { recursive: true })
      await copyFile(sourcePath, targetPath)
      const bytes = await readFile(targetPath)
      const sha256 = digest(bytes)
      const expected = expectedIntelHashes[gamePath]
      if (expected && sha256 !== expected) throw new Error(`Official Intel hash mismatch for ${gamePath}: ${sha256}`)
      copiedFiles.push({ path: gamePath, sha256, size: bytes.length, ...(expected ? { expectedOfficialMatch: true } : {}) })
    }
    vendorProvenance.push({
      name: vendor.name,
      upstream: vendor.upstream,
      licence: vendor.licence,
      source: vendor.source,
      versionEvidence: vendor.versionEvidence,
      files: copiedFiles,
      redistributionNoticePresent: copiedFiles.some(({ path }) => path === 'licenses/FidelityFX_v2_LICENSE.md' || path === 'licenses/XeSS_LICENSE.txt'),
    })
    input.components.push({ name: vendor.name, upstream: vendor.upstream, licence: vendor.licence, source: vendor.source })
    input.tiers['rtx-30-40'].sources.push({ folder: targetRoot, component: vendor.name })
  }

  input.id = recipe.id
  input.channel = recipe.channel
  input.minAppVersion = recipe.minAppVersion
  input.changelog = [...recipe.changelog]
  const tier = input.tiers['rtx-30-40']
  for (const source of tier.sources) {
    if (source.folder && !isAbsolute(source.folder)) source.folder = resolve(sourceRoot, source.folder)
  }
  // The user's 2026.10.14 values are kept for older clients; the four-column V2 profiles supersede them in this Beta.
  delete tier.performanceProfiles
  tier.performanceProfilesV2 = recipe.performanceProfilesV2
  tier.frameGenerationOptions = buildFrameGenerationOptions(recipe.frameGeneration)
  tier.screenDerivedSettings = recipe.screenDerivedSettings
  tier.hdrOptions = recipe.hdrOptions
  tier.sources.push({ folder: configOverlay, component: input.components.find((component) => component.name === 'OptiScaler')!.name })

  validateCandidateSettings(tier.frameGenerationOptions)
  validateCandidateIni(candidateIni, recipe.hotkeys)
  const publishInputPath = join(outputRoot, 'publish.json')
  await writeFile(publishInputPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8')
  const { manifestText } = await publishContent(publishInputPath, {
    manifestPath,
    dryRun: true,
    dryRunFilesDirectory: join(outputRoot, 'files'),
  })
  const generatedManifest = JSON.parse(manifestText) as { versions: Array<{ id: string; minAppVersion: string; channel: string }> }
  const generatedVersion = generatedManifest.versions.find(({ id }) => id === recipe.id)
  if (!generatedVersion || generatedVersion.channel !== recipe.channel || generatedVersion.minAppVersion !== recipe.minAppVersion) {
    throw new Error('The dry-run manifest did not contain the expected candidate version metadata.')
  }
  await writeFile(join(outputRoot, 'manifest.json'), manifestText, 'utf8')
  await writeFile(join(outputRoot, 'source-provenance.json'), `${JSON.stringify({
    candidate: recipe.id,
    baseContent: recipe.basedOnContent,
    sourceRoot,
    originalTestedSourcesModified: false,
    intelOfficialArchiveVerification: {
      release: 'XeSS SDK v3.0.2',
      url: 'https://github.com/intel/xess/tree/v3.0.2',
      matchingFiles: vendorProvenance.find(({ upstream }) => upstream === 'Intel')?.files ?? [],
      license: 'The exact local notice was also compared against the official v3.0.2 archive.',
    },
    vendors: vendorProvenance,
    dryRun: true,
    remotePublicationPerformed: false,
  }, null, 2)}\n`, 'utf8')
  console.log(`Prepared local dry-run candidate ${recipe.id} at ${outputRoot}`)
  console.log(`Review ${join(outputRoot, 'manifest.json')}, ${publishInputPath}, ${join(outputRoot, 'source-provenance.json')} and ${join(outputRoot, 'files')}.`)
}

function buildFrameGenerationOptions(spec: CandidateRecipe['frameGeneration']): FrameGenerationOption[] {
  const off = frameModeSettings('nofg', 1, false, false, false)
  const options: FrameGenerationOption[] = [{ id: 'off', settings: off }]
  const rtx30 = frameModeSettings(spec.rtx30.provider, 1, false, false, false)
  const hdrFrameGen = frameModeSettings(spec.rtx30.hdrProvider, spec.rtx30.hdrXeFgInterpolationCount, false,
    spec.rtx30.hdrXeFgUnlockMfg, spec.rtx30.hdrXeFgDynamicMfg, spec.rtx30.hdrXeFgMaxInterpolatedFrames)
  options.push({
    id: '2x', gpuNamePatterns: spec.rtx30.gpuPatterns, experimental: spec.rtx30.experimental,
    settings: rtx30,
    hdrSettings: hdrFrameGen.filter(({ section, key }) => section === 'FrameGen' && ['Enabled', 'FGInput', 'FGOutput', 'FGNvngxReplacement'].includes(key)
      || section === 'XeFG' && ['InterpolationCount', 'UnlockMFG', 'MaxInterpolatedFrames', 'DynamicMFG'].includes(key)),
  })
  for (const id of spec.rtx40.multipliers) {
    const dynamic = id === 'dynamic'
    const multiplier = dynamic ? 2 : Number(id.slice(0, -1))
    const count = dynamic ? 1 : multiplier - 1
    const unlock = dynamic || spec.rtx40.adaUnlockMultipliers.includes(id)
    options.push({
      id: id as FrameGenerationOption['id'],
      gpuNamePatterns: spec.rtx40.gpuPatterns,
      ...(id === '2x' || !dynamic ? { experimental: id === '2x' ? false : true } : { experimental: spec.rtx40.dynamicExperimentalPendingQa }),
      settings: frameModeSettings(spec.rtx40.provider, count, unlock, false, dynamic),
    })
  }
  return options
}

/** Every option rewrites both providers' unlock/count/dynamic knobs so a prior selection cannot leak across modes. */
function frameModeSettings(provider: 'nofg' | 'fsrfg' | 'xefg' | 'dlssg', dlssgCount: number,
  adaUnlock: boolean, xeUnlock: boolean, dynamic: boolean, xeMaxFrames = 1): IniSetting[] {
  const enabled = provider !== 'nofg'
  const fg = (key: string, value: string) => setting('FrameGen', key, value)
  const xe = (key: string, value: string) => setting('XeFG', key, value)
  const dlssg = (key: string, value: string) => setting('DLSSG', key, value)
  return [
    fg('Enabled', String(enabled)), fg('FGInput', enabled ? 'Upscaler' : 'nofg'),
    fg('FGOutput', provider), fg('FGNvngxReplacement', 'None'),
    xe('InterpolationCount', provider === 'xefg' ? String(dlssgCount) : '1'),
    xe('UnlockMFG', String(xeUnlock)), xe('MaxInterpolatedFrames', String(provider === 'xefg' ? xeMaxFrames : 1)),
    xe('DynamicMFG', String(provider === 'xefg' && dynamic)),
    dlssg('AdaMfgUnlock', String(adaUnlock)), dlssg('InterpolationCount', String(dlssgCount)),
    dlssg('ForceDMFG', String(dynamic)), dlssg('AmpereMfgUnlock', 'false'), dlssg('AmpereMfgMaxFrames', '1'),
  ]
}

function setting(section: string, key: string, value: string): IniSetting {
  return { file: 'OptiScaler.ini', section, key, value }
}

function rewriteCandidateIni(source: string, hotkeys: Record<string, string>): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  let text = source
  const modeOwnedKeys: Array<[string, string]> = [
    ['FrameGen', 'Enabled'], ['FrameGen', 'FGInput'], ['FrameGen', 'FGOutput'], ['FrameGen', 'FGNvngxReplacement'],
    ['XeFG', 'InterpolationCount'], ['XeFG', 'UnlockMFG'], ['XeFG', 'MaxInterpolatedFrames'], ['XeFG', 'DynamicMFG'], ['XeFG', 'DynamicTargetFPS'],
    ['DLSSG', 'AdaMfgUnlock'], ['DLSSG', 'InterpolationCount'], ['DLSSG', 'ForceDMFG'], ['DLSSG', 'FramerateTargetDMFG'],
    ['DLSSG', 'AmpereMfgUnlock'], ['DLSSG', 'AmpereMfgMaxFrames'], ['Framerate', 'FramerateLimit'],
    ['HDR', 'FfxivHDR'], ['HDR', 'Mode'], ['HDR', 'PeakNits'],
  ]
  for (const [section, key] of modeOwnedKeys) text = editIniKey(text, section, key, undefined, newline)
  for (const [qualifiedKey, value] of Object.entries(hotkeys)) {
    const separator = qualifiedKey.indexOf('.')
    if (separator < 1) throw new Error(`Invalid hotkey recipe key: ${qualifiedKey}`)
    text = editIniKey(text, qualifiedKey.slice(0, separator), qualifiedKey.slice(separator + 1), value, newline)
  }
  return text
}

function editIniKey(text: string, section: string, key: string, value: string | undefined, newline: string): string {
  const lines = text.split(/\r?\n/)
  const sectionExpression = new RegExp(`^\\s*\\[${escapeRegExp(section)}\\]\\s*(?:[;#].*)?$`, 'i')
  const keyExpression = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, 'i')
  let start = lines.findIndex((line) => sectionExpression.test(line))
  if (start < 0) {
    if (value === undefined) return text
    while (lines.length && lines.at(-1) === '') lines.pop()
    lines.push('', `[${section}]`, `${key} = ${value}`)
    return lines.join(newline)
  }
  let end = lines.findIndex((line, index) => index > start && /^\s*\[[^\]]+\]/.test(line))
  if (end < 0) end = lines.length
  let inserted = false
  for (let index = start + 1; index < end;) {
    if (!keyExpression.test(lines[index])) { index++; continue }
    if (value !== undefined && !inserted) {
      lines[index] = `${key} = ${value}`
      inserted = true
      index++
    } else {
      lines.splice(index, 1)
      end--
    }
  }
  if (value !== undefined && !inserted) {
    let insertAt = end
    while (insertAt > start + 1 && lines[insertAt - 1] === '') insertAt--
    lines.splice(insertAt, 0, `${key} = ${value}`)
  }
  return lines.join(newline)
}

function validateCandidateSettings(options: FrameGenerationOption[]): void {
  const twoX = options.find((option) => option.id === '2x' && option.gpuNamePatterns?.some((pattern) => /30\[0-9\]/.test(pattern)))
  if (!twoX) throw new Error('Candidate does not include RTX 30 2x.')
  for (const option of options.filter((candidate) => candidate.gpuNamePatterns?.some((pattern) => /30\[0-9\]/.test(pattern)))) {
    if (option.id !== '2x') throw new Error(`RTX 30 candidate must not include ${option.id}.`)
    for (const settings of [option.settings, ...(option.hdrSettings ? [option.hdrSettings] : [])]) {
      const values = new Map(settings.map(({ section, key, value }) => [`${section}.${key}`, value]))
      if (values.get('XeFG.UnlockMFG') !== 'false' || values.get('XeFG.InterpolationCount') !== '1'
        || values.get('XeFG.MaxInterpolatedFrames') !== '1' || values.get('XeFG.DynamicMFG') !== 'false') {
        throw new Error('RTX 30 2x must not unlock XeSS MFG in SDR or HDR.')
      }
    }
  }
  for (const option of options.filter((candidate) => candidate.id === '3x' || candidate.id === '4x' || candidate.id === '5x' || candidate.id === '6x')) {
    if (!option.gpuNamePatterns?.some((pattern) => /40\[0-9\]/.test(pattern)) || !option.experimental) {
      throw new Error(`RTX 40 ${option.id} must be Experimental and unavailable to RTX 30.`)
    }
  }
  if (options.some((candidate) => candidate.gpuNamePatterns?.some((pattern) => /30\[0-9\]/.test(pattern)) && candidate.id === 'dynamic')) {
    throw new Error('RTX 30 Dynamic must remain deferred.')
  }
  const hdrTwoX = twoX.hdrSettings ?? []
  const baseKeys = new Set(twoX.settings.map(({ section, key }) => `${section}.${key}`))
  if (hdrTwoX.some(({ section, key }) => !baseKeys.has(`${section}.${key}`))) {
    throw new Error('Each HDR frame-generation override must have a normal-mode baseline setting.')
  }
}

function validateCandidateIni(text: string, hotkeys: Record<string, string>): void {
  for (const [qualifiedKey, expected] of Object.entries(hotkeys)) {
    const [section, key] = qualifiedKey.split('.')
    const block = iniSection(text, section)
    const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*${escapeRegExp(expected)}\\s*$`, 'im')
    if (!block || !pattern.test(block)) throw new Error(`Candidate OptiScaler.ini is missing ${qualifiedKey}=${expected}.`)
  }
  for (const [section, keys] of Object.entries({
    FrameGen: ['Enabled', 'FGInput', 'FGOutput', 'FGNvngxReplacement'],
    XeFG: ['InterpolationCount', 'UnlockMFG', 'MaxInterpolatedFrames', 'DynamicMFG', 'DynamicTargetFPS'],
    DLSSG: ['AdaMfgUnlock', 'InterpolationCount', 'ForceDMFG', 'FramerateTargetDMFG', 'AmpereMfgUnlock', 'AmpereMfgMaxFrames'],
    Framerate: ['FramerateLimit'], HDR: ['FfxivHDR', 'Mode', 'PeakNits'],
  })) for (const key of keys) {
    const block = iniSection(text, section)
    if (block && new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, 'im').test(block)) throw new Error(`Mode-owned ${section}.${key} leaked into the base INI.`)
  }
}

function iniSection(text: string, section: string): string | null {
  const lines = text.split(/\r?\n/)
  const header = new RegExp(`^\\s*\\[${escapeRegExp(section)}\\]\\s*(?:[;#].*)?$`, 'i')
  const start = lines.findIndex((line) => header.test(line))
  if (start < 0) return null
  const end = lines.findIndex((line, index) => index > start && /^\s*\[[^\]]+\]/.test(line))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n')
}

function parseArgs(argv: string[]): { sourceRoot: string; outputRoot: string } {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument !== '--source-root' && argument !== '--output') throw new Error(`Unknown argument: ${argument}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Expected a path after ${argument}.`)
    if (values.has(argument)) throw new Error(`Duplicate argument: ${argument}`)
    values.set(argument, value)
  }
  const sourceRoot = values.get('--source-root')
  const outputRoot = values.get('--output')
  if (!sourceRoot || !outputRoot) throw new Error('Usage: npm run prepare:candidate -- --source-root C:/LucentContent --output C:/LucentContent/candidate-2026.10.15')
  return { sourceRoot, outputRoot }
}

async function requireDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory()) throw new Error(`Expected a directory: ${path}`)
}

async function requireFile(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile()) throw new Error(`Expected a regular file: ${path}`)
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function within(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child))
  return fromParent === '' || !(fromParent === '..' || fromParent.startsWith(`..${sep}`) || isAbsolute(fromParent))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
