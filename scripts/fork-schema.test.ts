import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkIniWrites, forkSchemaReport, iniKeyDelta, parseForkSchema, recipeIniWrites, type ForkSchema, type IniWrite } from './fork-schema'

const RETIRED_NOTE = 'Retired: menu HDR mapping is automatic; deleted from the ini on save.'

const schema: ForkSchema = {
  release: 'v0.5.0',
  commit: 'abc12345',
  keys: [
    { key: '[DlssNr] Enabled', section: 'DlssNr', name: 'Enabled', type: 'bool', values: null, min: null, max: null, applies: 'live' },
    { key: '[DlssNr] Precision', section: 'DlssNr', name: 'Precision', type: 'int', values: null, min: 0, max: 3, applies: 'live' },
    { key: '[DlssNr] Governor', section: 'DlssNr', name: 'Governor', type: 'enum', values: ['a', 'b'], min: null, max: null, applies: 'live' },
    { key: '[HudLess] Offset', section: 'HudLess', name: 'Offset', type: 'int', values: null, min: -2, max: 2, applies: 'live' },
    { key: '[HudLess] MaskThreshold', section: 'HudLess', name: 'MaskThreshold', type: 'float', values: null, min: 0.001, max: 1, applies: 'start' },
    { key: '[HudLess] Gamma', section: 'HudLess', name: 'Gamma', type: 'float', values: null, min: null, max: null, applies: 'live' },
    { key: '[HudLess] Mode', section: 'HudLess', name: 'Mode', type: 'enum', values: ['off', 'recomposition', 'ui_free'], min: null, max: null, applies: 'restart' },
    { key: '[Menu] Font', section: 'Menu', name: 'Font', type: 'string', values: null, min: null, max: null, applies: 'live' },
  ],
  retired: [{ key: '[HDR] MenuNits', note: RETIRED_NOTE }],
  aliases: [{ key: '[DlssNr] PauseOnFocusLoss', canonical: '[DlssNr] DisableOnFocusLoss', note: 'Another name for DisableOnFocusLoss.' }],
}

/** The keys the fork's own OptiScaler.ini holds; `NotInSchema` is there but the schema does not describe it. */
const forkIniKeys = [
  { section: 'DlssNr', key: 'Enabled' }, { section: 'DlssNr', key: 'Precision' }, { section: 'DlssNr', key: 'Governor' },
  { section: 'DlssNr', key: 'DisableOnFocusLoss' }, { section: 'DlssNr', key: 'NotInSchema' },
  { section: 'HudLess', key: 'Offset' }, { section: 'HudLess', key: 'MaskThreshold' }, { section: 'HudLess', key: 'Gamma' }, { section: 'HudLess', key: 'Mode' },
  { section: 'Menu', key: 'Font' },
]

const forkIni = [
  '[DlssNr]', 'Enabled=auto', 'Precision=auto', 'Governor=auto', 'DisableOnFocusLoss=auto', 'NotInSchema=auto',
  '[HudLess]', 'Offset=auto', 'MaskThreshold=auto', 'Gamma=auto', 'Mode=auto',
  '[Menu]', 'Font=auto', '',
].join('\n')

const write = (section: string, key: string, value: string, source = 'iniOverrides'): IniWrite => ({ source, section, key, value })
const check = (...writes: IniWrite[]) => checkIniWrites(schema, forkIniKeys, writes)

const effective = {
  format: 'settings-schema-effective',
  version: 1,
  release: 'v0.5.0',
  generatedFrom: { source: 'tools/settings-schema.json', commit: 'abc12345' },
  keys: [{
    key: '[DlssNr] Enabled', section: 'DlssNr', name: 'Enabled', codeType: 'bool', type: 'bool', default: 'auto', defaultMeans: 'false',
    values: null, min: null, max: null, applies: 'live', flags: null,
  }],
  retired: [{ key: '[HDR] MenuNits', note: RETIRED_NOTE }],
  aliases: [],
  untaggedYet: [],
  families: [],
}

const schemaFile = () => JSON.stringify({ ...effective, keys: schema.keys, retired: schema.retired, aliases: schema.aliases })

const temporary = async (body: (root: string) => Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), 'fork-schema-'))
  try { await body(root) } finally { await rm(root, { recursive: true, force: true }) }
}

describe('parseForkSchema', () => {
  it('reads the effective schema, a byte order mark and all', () => {
    expect(parseForkSchema(`\uFEFF${JSON.stringify(effective)}`)).toEqual({
      release: 'v0.5.0', commit: 'abc12345', keys: [schema.keys[0]], retired: [{ key: '[HDR] MenuNits', note: RETIRED_NOTE }], aliases: [],
    })
  })

  it('refuses another format', () => {
    expect(() => parseForkSchema(JSON.stringify({ ...effective, format: 'settings-schema' })))
      .toThrow('The fork\'s settings-schema.json is not the effective schema (format "settings-schema", version 1).')
  })

  it('refuses another version', () => {
    expect(() => parseForkSchema(JSON.stringify({ ...effective, version: 2 })))
      .toThrow('The fork\'s settings-schema.json is not the effective schema (format "settings-schema-effective", version 2).')
  })

  it('has no commit for a schema that carries none', () => {
    expect(parseForkSchema(JSON.stringify({ ...effective, generatedFrom: undefined })).commit).toBe('')
  })
})

describe('recipeIniWrites', () => {
  it('collects the recipe\'s OptiScaler.ini writes in order, with their sources', () => {
    const recipe = {
      settingChoices: [{
        id: 'frame-gen', label: 'Frame generation', defaultOption: '2x',
        options: [
          { id: '2x', label: '2x', description: '', settings: [
            { file: 'OptiScaler.ini', section: 'FrameGen', key: 'Enabled', value: 'true' },
            { file: 'ReShade.ini', section: 'STYLE', key: 'FontSize', value: '13.0' },
          ] },
          { id: 'off', label: 'Off', description: '', settings: [
            { file: 'OptiScaler.ini', section: 'FrameGen', key: 'Enabled', value: 'false' },
          ] },
        ],
      }],
      iniOverrides: [{ section: 'Menu', key: 'Font', value: 'Noto Sans' }],
      optiscalerUpdateKeys: [{ section: 'DlssNr', key: 'Enabled', value: 'auto' }],
    }
    expect(recipeIniWrites(recipe)).toEqual([
      { source: 'choice frame-gen/2x', section: 'FrameGen', key: 'Enabled', value: 'true' },
      { source: 'choice frame-gen/off', section: 'FrameGen', key: 'Enabled', value: 'false' },
      { source: 'iniOverrides', section: 'Menu', key: 'Font', value: 'Noto Sans' },
      { source: 'optiscalerUpdateKeys', section: 'DlssNr', key: 'Enabled', value: 'auto' },
    ])
  })
})

describe('checkIniWrites', () => {
  it('refuses a retired key before it reports the key missing from the ini', () => {
    expect(check(write('HDR', 'MenuNits', '100'))).toEqual({
      checked: 0, notInSchema: [], notLive: [], errors: [`iniOverrides: [HDR] MenuNits is retired in the fork: ${RETIRED_NOTE}`],
    })
  })

  it('refuses another name for a key and names the one to write', () => {
    expect(check(write('dlssnr', 'pauseonfocusloss', 'true')).errors).toEqual([
      'iniOverrides: [dlssnr] pauseonfocusloss is another name for [DlssNr] DisableOnFocusLoss; write [DlssNr] DisableOnFocusLoss',
    ])
  })

  it('refuses a key the fork\'s ini no longer has', () => {
    expect(check(write('Menu', 'Gone', '1')).errors).toEqual(['iniOverrides: [Menu] Gone is not in the fork\'s OptiScaler.ini'])
  })

  it('lists a key the schema does not describe, once, without refusing it', () => {
    expect(check(write('DlssNr', 'NotInSchema', '1'), write('DlssNr', 'NotInSchema', '2'))).toEqual({
      checked: 0, notInSchema: ['[DlssNr] NotInSchema'], notLive: [], errors: [],
    })
  })

  it('matches a key without regard to case', () => {
    expect(check(write('dlssnr', 'governor', 'a'))).toEqual({ checked: 1, notInSchema: [], notLive: [], errors: [] })
  })

  it('accepts auto whatever the type', () => {
    const result = check(...schema.keys.map((key) => write(key.section, key.name, 'AUTO')))
    expect(result.errors).toEqual([])
    expect(result.checked).toBe(schema.keys.length)
  })

  it('accepts true and FALSE for a bool, and refuses 1', () => {
    expect(check(write('DlssNr', 'Enabled', 'true'), write('DlssNr', 'Enabled', 'FALSE')).errors).toEqual([])
    expect(check(write('DlssNr', 'Enabled', '1')).errors).toEqual(['iniOverrides: [DlssNr] Enabled = 1 is not a valid bool'])
  })

  it('accepts an int at both ends of its range, and refuses one past either end or a fraction', () => {
    expect(check(write('DlssNr', 'Precision', '3'), write('DlssNr', 'Precision', '0')).errors).toEqual([])
    expect(check(write('DlssNr', 'Precision', '4')).errors).toEqual(['iniOverrides: [DlssNr] Precision = 4 is not a valid int (0 to 3)'])
    expect(check(write('DlssNr', 'Precision', '-1')).errors).toEqual(['iniOverrides: [DlssNr] Precision = -1 is not a valid int (0 to 3)'])
    expect(check(write('DlssNr', 'Precision', '1.5')).errors).toEqual(['iniOverrides: [DlssNr] Precision = 1.5 is not a valid int (0 to 3)'])
  })

  it('accepts a negative int above a negative minimum', () => {
    expect(check(write('HudLess', 'Offset', '-1')).errors).toEqual([])
    expect(check(write('HudLess', 'Offset', '3')).errors).toEqual(['iniOverrides: [HudLess] Offset = 3 is not a valid int (-2 to 2)'])
  })

  it('accepts a float in range at both ends, and refuses text, an empty value and one past the maximum', () => {
    expect(check(write('HudLess', 'MaskThreshold', '0.5'), write('HudLess', 'MaskThreshold', '0.001'), write('HudLess', 'MaskThreshold', '1')).errors).toEqual([])
    expect(check(write('HudLess', 'MaskThreshold', 'abc')).errors).toEqual(['iniOverrides: [HudLess] MaskThreshold = abc is not a valid float (0.001 to 1)'])
    expect(check(write('HudLess', 'MaskThreshold', '')).errors).toEqual(['iniOverrides: [HudLess] MaskThreshold =  is not a valid float (0.001 to 1)'])
    expect(check(write('HudLess', 'MaskThreshold', '1.5')).errors).toEqual(['iniOverrides: [HudLess] MaskThreshold = 1.5 is not a valid float (0.001 to 1)'])
    expect(check(write('HudLess', 'Gamma', '2.5')).errors).toEqual([])
    expect(check(write('HudLess', 'Gamma', 'abc')).errors).toEqual(['iniOverrides: [HudLess] Gamma = abc is not a valid float'])
    // Number('') is 0, so without a lower bound only the empty check refuses a blank value.
    expect(check(write('HudLess', 'Gamma', ' ')).errors).toEqual(['iniOverrides: [HudLess] Gamma =  is not a valid float'])
  })

  it('accepts an enum member in any case, and lists the members it refused', () => {
    expect(check(write('HudLess', 'Mode', 'UI_Free')).errors).toEqual([])
    expect(check(write('HudLess', 'Mode', 'bogus')).errors).toEqual(['iniOverrides: [HudLess] Mode = bogus is not a valid enum (one of off, recomposition, ui_free)'])
  })

  it('accepts any text for a string key', () => {
    expect(check(write('Menu', 'Font', 'Noto Sans, 15')).errors).toEqual([])
  })

  it('counts what it accepted and lists the writes that need a start or a restart', () => {
    const result = check(
      write('DlssNr', 'Enabled', 'true'),
      write('HudLess', 'MaskThreshold', '0.5', 'choice frame-gen/2x'),
      write('HudLess', 'Mode', 'off'),
    )
    expect(result.checked).toBe(3)
    expect(result.notLive).toEqual([
      { key: '[HudLess] MaskThreshold', applies: 'start', source: 'choice frame-gen/2x' },
      { key: '[HudLess] Mode', applies: 'restart', source: 'iniOverrides' },
    ])
  })
})

describe('forkSchemaReport', () => {
  it('reports nothing when the package does not list a settings schema', async () => {
    await temporary(async (root) => {
      await writeFile(join(root, 'settings-schema.json'), schemaFile())
      const recipe = { iniOverrides: [{ section: 'DlssNr', key: 'Enabled', value: 'true' }] }
      expect(await forkSchemaReport(root, ['OptiScaler.ini', 'winmm.dll'], recipe, forkIni)).toBeNull()
    })
  })

  it('reports what it checked when the package lists one', async () => {
    await temporary(async (root) => {
      await writeFile(join(root, 'settings-schema.json'), schemaFile())
      const recipe = { iniOverrides: [{ section: 'DlssNr', key: 'NotInSchema', value: '1' }, { section: 'HudLess', key: 'MaskThreshold', value: '0.5' }] }
      expect(await forkSchemaReport(root, ['OptiScaler.ini', 'settings-schema.json'], recipe, forkIni)).toEqual({
        release: 'v0.5.0', commit: 'abc12345', checked: 1, notInSchema: ['[DlssNr] NotInSchema'],
        notLive: [{ key: '[HudLess] MaskThreshold', applies: 'start', source: 'iniOverrides' }], retired: ['[HDR] MenuNits'],
      })
    })
  })

  it('refuses a recipe with two bad writes, naming both', async () => {
    await temporary(async (root) => {
      await writeFile(join(root, 'settings-schema.json'), schemaFile())
      const recipe = { iniOverrides: [{ section: 'HDR', key: 'MenuNits', value: '100' }, { section: 'Menu', key: 'Gone', value: '1' }] }
      await expect(forkSchemaReport(root, ['settings-schema.json'], recipe, forkIni)).rejects.toThrow([
        'The recipe writes keys the fork\'s settings schema refuses:',
        `iniOverrides: [HDR] MenuNits is retired in the fork: ${RETIRED_NOTE}`,
        'iniOverrides: [Menu] Gone is not in the fork\'s OptiScaler.ini',
      ].join('\n'))
    })
  })
})

describe('iniKeyDelta', () => {
  const ini = (...lines: string[]) => lines.join('\n')

  it('compares keys without regard to case, so a key that only changed its casing is in neither list', () => {
    const previous = ini('[Upscalers]', 'Dx11Upscaler=auto', '[DlssNr]', 'Enabled=auto', '')
    const next = ini('[upscalers]', 'DX11UPSCALER=auto', '[dlssnr]', 'enabled=auto', '')
    expect(iniKeyDelta(previous, next)).toEqual({ added: [], removed: [] })
  })

  it('lists the keys added and the keys removed, each in its own file\'s order', () => {
    const previous = ini('[Menu]', 'Font=auto', 'Old=1', '[Gone]', 'A=1', '')
    const next = ini('[Menu]', 'Font=auto', 'New=1', 'Added=1', '')
    expect(iniKeyDelta(previous, next)).toEqual({ added: ['[Menu] New', '[Menu] Added'], removed: ['[Menu] Old', '[Gone] A'] })
  })

  it('keeps each key once', () => {
    const previous = ini('[Menu]', 'Dup=1', 'Dup=2', '')
    const next = ini('[Menu]', 'New=1', 'New=2', '')
    expect(iniKeyDelta(previous, next)).toEqual({ added: ['[Menu] New'], removed: ['[Menu] Dup'] })
  })

  it('takes an absent previous ini as empty', () => {
    expect(iniKeyDelta('', ini('[Menu]', 'Font=auto', ''))).toEqual({ added: ['[Menu] Font'], removed: [] })
  })
})
