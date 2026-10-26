import { describe, expect, it } from 'vitest'
import { ManifestError, parseManifest, type SettingChoice } from './manifest'
import { PASS_HINT_CHOICES, SETTING_CHOICES, SETTING_CHOICE_MANIFEST } from '../platform/contentFixture'

/** The fixture manifest with `choices` on every NVIDIA tier, as the text a player's app would read. */
const withChoices = (choices: unknown): string => JSON.stringify({
  ...SETTING_CHOICE_MANIFEST,
  versions: SETTING_CHOICE_MANIFEST.versions.map((content) => ({
    ...content,
    tiers: Object.fromEntries(Object.entries(content.tiers).map(([id, tier]) => [id, id.startsWith('rtx-') ? { ...tier, settingChoices: choices } : tier])),
  })),
})
const ui = SETTING_CHOICES[0]
const preset = SETTING_CHOICES[1]
const setting = (section: string, key: string, value: string, file = 'OptiScaler.ini') => ({ file, section, key, value })
const option = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, description: `The ${id} option.`, settings: [setting('Test', 'Key', id)], ...extra })
const group = (extra: Record<string, unknown> = {}) => ({ id: 'test', label: 'Test', defaultOption: 'a', options: [option('a'), option('b')], ...extra })
const tierChoices = (text: string): SettingChoice[] | undefined => parseManifest(text).versions[0].tiers['rtx-20-30-40'].settingChoices

describe('setting choices in the manifest', () => {
  it('reads the UI mode and DLSS-G preset choices, and nothing where a tier declares none', () => {
    expect(tierChoices(withChoices(SETTING_CHOICES))).toEqual(SETTING_CHOICES)
    const parsed = parseManifest(JSON.stringify(SETTING_CHOICE_MANIFEST))
    expect(parsed.versions[0].tiers['rtx-20-30-40'].settingChoices).toEqual(SETTING_CHOICES)
    expect(parsed.versions[0].tiers['radeon']?.settingChoices).toBeUndefined()
  })

  it('reads where a choice sits on the Graphics step and how many passes it needs, and leaves both absent otherwise', () => {
    expect(tierChoices(withChoices([...SETTING_CHOICES, ...PASS_HINT_CHOICES]))).toEqual([...SETTING_CHOICES, ...PASS_HINT_CHOICES])
    const read = tierChoices(withChoices([...SETTING_CHOICES, ...PASS_HINT_CHOICES]))!
    expect(read.map((choice) => [choice.id, choice.minPasses ?? null, choice.placement?.in ?? null])).toEqual([
      ['ui-mode', null, null], ['dlssg-preset', null, null],
      ['nr-hint-pass-1', null, 'neural-rendering'], ['nr-hint-pass-2', 2, 'neural-rendering'], ['nr-hint-pass-3', 3, 'neural-rendering'],
    ])
    expect(read[2].placement).toEqual({ in: 'neural-rendering', group: 'Advanced Neural Rendering model hints (effect unverified)', note: 'Hints the Neural Rendering model receives for each pass.' })
  })

  it('rejects a placed or pass-counting choice on a tier that has no Neural Rendering controls, where nothing would show it', () => {
    const noControls = (choices: unknown) => {
      const manifest = JSON.parse(withChoices(choices))
      for (const tier of Object.values(manifest.versions[0].tiers) as { neuralRenderingControls?: unknown; performanceProfilesV2?: unknown }[]) delete tier.neuralRenderingControls
      return JSON.stringify(manifest)
    }
    expect(() => parseManifest(noControls(PASS_HINT_CHOICES))).toThrow(ManifestError)
    expect(() => parseManifest(noControls([group({ minPasses: 2 })]))).toThrow(ManifestError)
    expect(() => parseManifest(noControls(SETTING_CHOICES))).not.toThrow()
  })

  it('stays readable when the choices are an empty list', () => {
    expect(tierChoices(withChoices([]))).toEqual([])
  })

  it.each([
    ['not a list', {}],
    ['a group that is not an object', ['ui-mode']],
    ['an empty id', [group({ id: '' })]],
    ['an id with capitals', [group({ id: 'UiMode' })]],
    ['an empty label', [group({ label: ' ' })]],
    ['a multi-line label', [group({ label: 'Test\nInjected' })]],
    ['one option', [group({ options: [option('a')], defaultOption: 'a' })]],
    ['a duplicate option id', [group({ options: [option('a'), option('a')] })]],
    ['an option id with a space', [group({ options: [option('a'), option('b c')] })]],
    ['an empty option label', [group({ options: [option('a'), option('b', { label: '' })] })]],
    ['an empty option description', [group({ options: [option('a'), option('b', { description: '' })] })]],
    ['an experimental flag that is not a boolean', [group({ options: [option('a'), option('b', { experimental: 'yes' })] })]],
    ['an option without settings', [group({ options: [option('a'), option('b', { settings: [] })] })]],
    ['a duplicate key inside an option', [group({ options: [option('a'), option('b', { settings: [setting('Test', 'Key', '1'), setting('test', 'key', '2')] })] })]],
    ['a value over several lines', [group({ options: [option('a'), option('b', { settings: [setting('Test', 'Key', '1\n2')] })] })]],
    ['a default that is not an option', [group({ defaultOption: 'c' })]],
    ['an unoffered option that is not an option', [group({ unofferedOption: 'c' })]],
    ['a gpu pattern that is not a regular expression', [group({ gpuNamePatterns: ['['] })]],
    ['empty gpu patterns', [group({ gpuNamePatterns: [] })]],
    ['needsFrameGeneration that is not a boolean', [group({ needsFrameGeneration: 'yes' })]],
    ['minPasses of 1', [group({ minPasses: 1 })]],
    ['minPasses that is not a number', [group({ minPasses: '2' })]],
    ['a placement that is not an object', [group({ placement: 'neural-rendering' })]],
    ['a placement somewhere unknown', [group({ placement: { in: 'frame-generation' } })]],
    ['a placement group over several lines', [group({ placement: { in: 'neural-rendering', group: 'A\nB' } })]],
    ['a placement group that is far too long', [group({ placement: { in: 'neural-rendering', group: 'x'.repeat(81) } })]],
    ['a placement note that is far too long', [group({ placement: { in: 'neural-rendering', note: 'x'.repeat(241) } })]],
    ['a setting in a config the tier does not own', [group({ options: [option('a'), option('b', { settings: [setting('Test', 'Key', '1', 'Other.ini')] })] })]],
    ['a duplicate group id', [group(), group()]],
    ['options that write different keys', [group({ options: [option('a'), option('b', { settings: [setting('Test', 'Other', 'b')] })] })]],
    ['two choices that write the same key', [group({ id: 'first' }), group({ id: 'second' })]],
    ['a block without a reason', [group({ options: [option('a'), option('b', { blockedWhen: [{ hdr: true }] })] })]],
    ['a block with no condition', [group({ options: [option('a'), option('b', { blockedWhen: [{ reason: 'Because.' }] })] })]],
    ['a block that names a later group', [group({ id: 'first', options: [option('a'), option('b', { blockedWhen: [{ reason: 'Because.', choice: { id: 'second', options: ['x'] } }] })] }), group({ id: 'second', options: [option('x'), option('y')], defaultOption: 'x' })]],
    ['a block that names its own group', [group({ options: [option('a'), option('b', { blockedWhen: [{ reason: 'Because.', choice: { id: 'test', options: ['a'] } }] })] })]],
    ['a block that names an unknown group', [group({ options: [option('a'), option('b', { blockedWhen: [{ reason: 'Because.', choice: { id: 'nope', options: ['a'] } }] })] })]],
    ['a block that names an option the other group lacks', [group({ id: 'first' }), group({ id: 'second', options: [option('a'), option('b', { blockedWhen: [{ reason: 'Because.', choice: { id: 'first', options: ['zzz'] } }] })] })]],
    ['a group in which every option can be blocked', [group({ id: 'first' }), group({ id: 'second', options: [option('a', { blockedWhen: [{ reason: 'Because.', hdr: true }] }), option('b', { blockedWhen: [{ reason: 'Because.', hdr: true }] })] })]],
  ])('rejects a choice with %s', (_, choices) => {
    expect(() => parseManifest(withChoices(choices))).toThrow(ManifestError)
  })

  it('ignores a tier field an older app has never heard of, so published content can add choices safely', () => {
    // The parsers of 0.3.0-beta.8 and 0.3.0-beta.9 read known fields only, so the published manifest stays valid for them.
    const text = withChoices(SETTING_CHOICES)
    const parsed = JSON.parse(text)
    expect(parsed.versions[0].tiers['rtx-20-30-40'].settingChoices).toHaveLength(2)
    expect(preset.options.map((o) => o.id)).toEqual(['auto', 'a', 'b', 'c'])
    expect(ui.options.map((o) => o.id)).toEqual(['off', 'recomposition', 'ui-free'])
  })
})
