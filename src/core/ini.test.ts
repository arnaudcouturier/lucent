import { expect, it } from 'vitest'
import { mergeIni, readIni } from './ini'

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

it('merge: a key unchanged on disk but changed in the new version takes the new value', () => {
  const base = '[GENERAL]\nPresetPath=\nKeyOverlay=36,0,0,0\n'
  const disk = '[GENERAL]\nPresetPath=\nKeyOverlay=36,0,0,0\n'
  const incoming = '[GENERAL]\nPresetPath=\nKeyOverlay=37,0,0,0\n'
  expect(mergeIni(base, disk, incoming)).toBe('[GENERAL]\nPresetPath=\nKeyOverlay=37,0,0,0\n')
})

it('merge: a user change to a key the new version did not change is kept', () => {
  const base = '[GENERAL]\nPresetPath=\n[INPUT]\nKeyOverlay=36,0,0,0\n'
  const disk = '[GENERAL]\nPresetPath=reshade-presets/My look.ini\n[INPUT]\nKeyOverlay=36,0,0,0\n'
  const incoming = '[GENERAL]\nPresetPath=\n[INPUT]\nKeyOverlay=36,0,0,0\n'
  expect(mergeIni(base, disk, incoming)).toBe('[GENERAL]\nPresetPath=reshade-presets/My look.ini\n[INPUT]\nKeyOverlay=36,0,0,0\n')
})

it('merge: when the player and the new version both changed a key, Lucent’s value wins', () => {
  const base = '[DlssNr]\nPasses=2\n'
  const disk = '[DlssNr]\nPasses=5\n'
  const incoming = '[DlssNr]\nPasses=1\n'
  expect(mergeIni(base, disk, incoming)).toBe('[DlssNr]\nPasses=1\n')
})

it('merge: a reset key takes Lucent’s value even when only the player changed it', () => {
  const base = '[Logging]\nLogToFile=false\n'
  const disk = '[Logging]\nLogToFile=true\n'
  const incoming = '[Logging]\nLogToFile=false\n'
  expect(mergeIni(base, disk, incoming, [{ section: 'Logging', key: 'LogToFile' }])).toBe('[Logging]\nLogToFile=false\n')
  // Reset matching is case-insensitive, like every other INI lookup.
  expect(mergeIni(base, disk, incoming, [{ section: 'logging', key: 'logtofile' }])).toBe('[Logging]\nLogToFile=false\n')
})

it('merge: keys the new version dropped are removed, even ones the player changed', () => {
  const base = '[GENERAL]\nPresetPath=\nOldKey=old\n'
  const disk = '[GENERAL]\nPresetPath=\nOldKey=mine\n'
  const incoming = '[GENERAL]\nPresetPath=\n'
  expect(mergeIni(base, disk, incoming)).toBe('[GENERAL]\nPresetPath=\n')
})

it('merge: the result follows the new version’s layout and comments', () => {
  const base = '[GENERAL]\nPresetPath=\nKeyOverlay=36,0,0,0\n'
  const disk = '[GENERAL]\nPresetPath=My look.ini\nKeyOverlay=36,0,0,0\n'
  const incoming = '; New layout\n[INPUT]\n; Overlay key\nKeyOverlay = 36,0,0,0\n[GENERAL]\nPresetPath=\n'
  expect(mergeIni(base, disk, incoming)).toBe('; New layout\n[INPUT]\n; Overlay key\nKeyOverlay = 36,0,0,0\n[GENERAL]\nPresetPath=My look.ini\n')
})

it('merge: a key the player deleted stays deleted when Lucent did not change it', () => {
  const base = '[GENERAL]\nPresetPath=\nOldKey=old\n'
  const disk = '[GENERAL]\nPresetPath=\n'
  const incoming = '[GENERAL]\nPresetPath=\nOldKey=old\n'
  expect(mergeIni(base, disk, incoming)).toBe('[GENERAL]\nPresetPath=\n')
  // But a deleted key Lucent changed comes back with Lucent’s value.
  expect(mergeIni(base, disk, '[GENERAL]\nPresetPath=\nOldKey=new\n')).toBe('[GENERAL]\nPresetPath=\nOldKey=new\n')
})

it('merge: a key the player added that Lucent never shipped is kept', () => {
  const base = '[GENERAL]\nPresetPath=\n'
  const disk = '[GENERAL]\nPresetPath=\nMyKey=hello\n'
  const incoming = '[GENERAL]\nPresetPath=\n'
  expect(mergeIni(base, disk, incoming)).toBe('[GENERAL]\nPresetPath=\nMyKey=hello\n')
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
