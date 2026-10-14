import { describe, expect, it } from 'vitest'
import { activeEffects, unusedShaderFiles } from './shader-usage'

const source = (files: Record<string, string>) => Object.entries(files).map(([path, text]) => ({ path, read: async () => text }))

describe('Shipping only the shaders the presets use', () => {
  it('reads the effects a preset turns on, not the ones it only sorts or stores values for', () => {
    expect(activeEffects('Techniques=Bloom@Glow.fx,Tone,,Map@Tone Map.fx\nTechniqueSorting=Bloom@Glow.fx,Unused@Unused.fx\n[Unused.fx]\nX=1')).toEqual(['Glow.fx', 'Tone Map.fx'])
  })

  it('keeps preset effects, what they include from any folder, the textures named along the way, and their folders’ licences', async () => {
    const unused = await unusedShaderFiles(source({
      'reshade-presets/Look.ini': 'Techniques=Glow@Glow.fx,Grade@Grade.fx\nTechniqueSorting=Unused@Unused.fx\nPreprocessorDefinitions=LUT_NAME="custom_lut.png"',
      // Only presets count: another add-on's config naming an effect doesn't ship it.
      'ReshadeEffectShaderToggler.ini': 'Techniques=AA [SMAA.fx]',
      'reshade-shaders/Shaders/Glow.fx': '#include "Common.fxh"\ntexture Dirt < source = "dirt.png"; >',
      'reshade-shaders/Shaders/Pack/Common.fxh': '#include "Deeper.fxh"',
      'reshade-shaders/Shaders/Other/Deeper.fxh': '#define NOISE "noise.jpg"',
      'reshade-shaders/Shaders/Grade.fx': 'texture Lut < source = LUT_NAME; >',
      'reshade-shaders/Shaders/SMAA.fx': '',
      'reshade-shaders/Shaders/Unused.fx': '#include "UnusedOnly.fxh"\ntexture T < source = "unused.png"; >',
      'reshade-shaders/Shaders/UnusedOnly.fxh': '',
      'reshade-shaders/Shaders/Dropped/Effect.fx': '', 'reshade-shaders/Shaders/Dropped/LICENSE.txt': '',
      'reshade-shaders/Textures/dirt.png': '', 'reshade-shaders/Textures/Noise/noise.jpg': '',
      'reshade-shaders/Textures/custom_lut.png': '', 'reshade-shaders/Textures/unused.png': '', 'reshade-shaders/Textures/Junk/dummy': '',
      'reshade-shaders/Shaders/Pack/LICENSE': '', 'reshade-shaders/README.md': '', 'licenses/ReShade.txt': '',
    }))
    expect(unused.sort()).toEqual([
      'reshade-shaders/Shaders/Dropped/Effect.fx', 'reshade-shaders/Shaders/Dropped/LICENSE.txt', 'reshade-shaders/Shaders/SMAA.fx',
      'reshade-shaders/Shaders/Unused.fx', 'reshade-shaders/Shaders/UnusedOnly.fxh', 'reshade-shaders/Textures/Junk/dummy', 'reshade-shaders/Textures/unused.png',
    ])
  })

  it('leaves a source without shaders alone', async () => {
    expect(await unusedShaderFiles(source({ 'winmm.dll': '', 'licenses/LICENSE.txt': '' }))).toEqual([])
  })

  it('follows non-FXH includes and their textures without shipping unused headers or configs', async () => {
    const unused = await unusedShaderFiles(source({
      'reshade-presets/Look.ini': 'Techniques=Used@Used.fx',
      'reshade-shaders/Shaders/Used.fx': '#include "Include/Used.hlsl"',
      'reshade-shaders/Shaders/Include/Used.hlsl': '#include "Detail.h"\ntexture T < source = "needed.png"; >',
      'reshade-shaders/Shaders/Include/Detail.h': '#include "Extensionless"',
      'reshade-shaders/Shaders/Include/Extensionless': '#include "Used.hlsl"',
      'reshade-shaders/Shaders/Include/Unused.hlsl': 'texture T < source = "unused.png"; >',
      'reshade-shaders/Shaders/Include/LICENSE.txt': '',
      'reshade-shaders/Shaders/Example.ini': '',
      'reshade-shaders/Textures/needed.png': '',
      'reshade-shaders/Textures/unused.png': '',
    }))
    expect(unused.sort()).toEqual([
      'reshade-shaders/Shaders/Example.ini', 'reshade-shaders/Shaders/Include/Unused.hlsl', 'reshade-shaders/Textures/unused.png',
    ])
  })
})
