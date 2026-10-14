import { expect, it } from 'vitest'
import { addMissingKeys, readIni } from './ini'

it.each([
  '\uFEFF; OptiScaler\r\n[DlssNr]\r\n  Passes = 2  \r\nEnabled=true\r\n',
  '# ReShade\n[GENERAL]\nPresetPath=.\\reshade-presets\\My look.ini\n\n[INPUT]\nKeyOverlay=36,0,0,0',
])('keeps a config byte-identical when reading and writing without changes', (text) => {
  const config = readIni(text)
  expect(config.toString()).toBe(text)
})

it('reads # and ; inside a value as part of it, since neither format has inline comments', () => {
  const config = readIni('[GENERAL]\r\nPresetPath=D:\\Presets\\Look #2.ini\r\nEffectSearchPaths=D:\\My ;Shaders\\**\r\n')
  expect(config.get('GENERAL', 'PresetPath')).toBe('D:\\Presets\\Look #2.ini')
  expect(config.get('GENERAL', 'EffectSearchPaths')).toBe('D:\\My ;Shaders\\**')
  config.set('GENERAL', 'PresetPath', 'New look.ini')
  expect(config.toString()).toBe('[GENERAL]\r\nPresetPath=New look.ini\r\nEffectSearchPaths=D:\\My ;Shaders\\**\r\n')
})

it('supports settings before a section and keeps the absence of a final newline', () => {
  const config = readIni('; Header\nRootKey=old\n\n[GENERAL]\nPresetPath=')
  config.set('', 'RootKey', 'new')
  config.set('', 'NewKey', 'value')
  config.set('INPUT', 'KeyOverlay', '36,0,0,0')
  expect(config.toString()).toBe('; Header\nRootKey=new\nNewKey=value\n\n[GENERAL]\nPresetPath=\n\n[INPUT]\nKeyOverlay=36,0,0,0')
})

it('edits duplicate keys consistently and keeps the whitespace around values', () => {
  const config = readIni('[GENERAL]\nPresetPath=\n[DlssNr]\nPasses=2\n  Passes = 2  \n')
  expect(config.get('GENERAL', 'PresetPath')).toBe('')
  config.set('GENERAL', 'PresetPath', 'My look.ini')
  config.set('DlssNr', 'Passes', '1')
  expect(config.toString()).toBe('[GENERAL]\nPresetPath=My look.ini\n[DlssNr]\nPasses=1\n  Passes = 1  \n')
})

it('adds absent keys and sections without dropping existing comments', () => {
  const config = readIni('[GENERAL]\r\nPresetPath="C:\\Looks\\My look.ini"\r\n; keep this\r\n\r\n[INPUT]\r\nKeyOverlay=36,0,0,0\r\n')
  expect(config.get('GENERAL', 'PresetPath')).toBe('"C:\\Looks\\My look.ini"')
  config.set('GENERAL', 'EffectSearchPaths', '.\\reshade-shaders\\Shaders\\**')
  config.set('Logging', 'LogToFile', 'false')
  expect(config.toString()).toBe('[GENERAL]\r\nPresetPath="C:\\Looks\\My look.ini"\r\n; keep this\r\nEffectSearchPaths=.\\reshade-shaders\\Shaders\\**\r\n\r\n[INPUT]\r\nKeyOverlay=36,0,0,0\r\n\r\n[Logging]\r\nLogToFile=false\r\n')
})

it('addMissingKeys: writes only the keys absent on disk, with the baseline’s value', () => {
  const baseline = '[GENERAL]\nPresetPath=\n[DlssNr]\nPasses=2\nNewKey=on\n'
  const disk = '[GENERAL]\nPresetPath=reshade-presets/My look.ini\n[DlssNr]\nPasses=5\n'
  expect(addMissingKeys(disk, baseline)).toEqual({ text: '[GENERAL]\nPresetPath=reshade-presets/My look.ini\n[DlssNr]\nPasses=5\nNewKey=on\n', added: ['DlssNr/NewKey'] })
})

it('addMissingKeys: keeps the layout and comments on disk, and adds a missing section at the end', () => {
  const baseline = '; Lucent layout\n[INPUT]\n; Overlay key\nKeyOverlay = 36,0,0,0\n[Logging]\nLogToFile=false\n'
  const disk = '; My notes\r\n[INPUT]\r\nKeyOverlay=40,0,0,0\r\n'
  expect(addMissingKeys(disk, baseline)).toEqual({ text: '; My notes\r\n[INPUT]\r\nKeyOverlay=40,0,0,0\r\n\r\n[Logging]\r\nLogToFile=false\r\n', added: ['Logging/LogToFile'] })
})

it('addMissingKeys: matches names without regard to case, and leaves a file with nothing missing as it is', () => {
  const disk = '[dlssnr]\npasses=5\nMyKey=hello\n'
  expect(addMissingKeys(disk, '[DlssNr]\nPasses=2\n')).toEqual({ text: disk, added: [] })
})

it('changes only the requested value, preserving whitespace, comments, BOM and line endings', () => {
  const config = readIni('\uFEFF; OptiScaler\r\n[DlssNr]\r\n; Neural Rendering passes\r\n  Passes = 2  \r\nEnabled = true\r\n\r\n[Logging]\r\nLogLevel=0')
  expect(config.get('dlssnr', 'passes')).toBe('2')
  config.set('DlssNr', 'Passes', '1')
  expect(config.toString()).toBe('\uFEFF; OptiScaler\r\n[DlssNr]\r\n; Neural Rendering passes\r\n  Passes = 1  \r\nEnabled = true\r\n\r\n[Logging]\r\nLogLevel=0')
  const changed = config.toString()
  config.set('DlssNr', 'Passes', '1')
  expect(config.toString()).toBe(changed)
})
