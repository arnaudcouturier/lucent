import { describe, expect, it } from 'vitest'
import { ManifestError, parseManifest, type SettingChoice } from './manifest'
import { SETTING_CHOICES, SETTING_CHOICE_MANIFEST } from '../platform/contentFixture'

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
