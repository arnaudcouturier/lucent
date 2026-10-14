// Which shader files and textures a content version actually needs: the effects its presets turn on, every file
// those effects include, and the textures they and the presets name. Everything else in a shader pack is never
// loaded by a shipped preset, so publishing it would only fill the player's game folder.
import { basename } from 'node:path'

export interface SourceFile { path: string; read(): Promise<string> }

const slashes = (path: string) => path.replace(/\\/g, '/')
const name = (path: string) => basename(slashes(path)).toLowerCase()
const isShader = (path: string) => /\.(fx|fxh)$/i.test(path)
const isPreset = (path: string) => /^reshade-presets\//i.test(slashes(path)) && /\.ini$/i.test(path)
const isLicence = (path: string) => /^(licen[cs]e|copying|notice|readme)/i.test(name(path)) || /licen[cs]e/i.test(name(path))
/** Everything in a textures folder is data an effect loads (images, LUT cubes), except its licence. */
const isTexture = (path: string) => /(^|\/)textures\//i.test(slashes(path)) && !isLicence(path)

/** The effects a preset turns on: `Techniques=Name@File.fx`. `TechniqueSorting` and `[File.fx]` sections only order and store values. */
export function activeEffects(ini: string): string[] {
  const effects: string[] = []
  for (const line of ini.split(/\r\n|\r|\n/)) {
    const assignment = /^\s*Techniques\s*=(.*)$/i.exec(line)
    if (!assignment) continue
    // ReShade escapes commas inside names as ",,".
    for (const technique of assignment[1].split(/(?<!,),(?!,)/)) {
      const reference = /@\s*([^@]+\.fx)\s*$/i.exec(technique)
      if (reference) effects.push(reference[1].trim())
    }
  }
  return effects
}

/**
 * Paths among `files` that no shipped preset needs: shaders and textures nothing active uses, and the licences and
 * readmes of shader folders left with nothing. Files outside the shader folders are never touched.
 */
export async function unusedShaderFiles(files: SourceFile[]): Promise<string[]> {
  const shaders = files.filter((f) => isShader(f.path))
  if (!shaders.length) return []
  const roots = new Set(shaders.map((f) => slashes(f.path).split('/')[0].toLowerCase()))
  const inRoots = (f: SourceFile) => slashes(f.path).includes('/') && roots.has(slashes(f.path).split('/')[0].toLowerCase())
  const byName = new Map<string, SourceFile[]>()
  // Includes can be HLSL, headers, or extensionless source; only preset entry points must be FX files.
  for (const file of files.filter(inRoots)) byName.set(name(file.path), [...byName.get(name(file.path)) ?? [], file])
  const presets = await Promise.all(files.filter((f) => isPreset(f.path)).map((f) => f.read()))
  // ReShade looks for an effect and its includes across every shader folder, so any file of that name may be the one.
  const used = new Set<SourceFile>()
  const queue = presets.flatMap(activeEffects).flatMap((effect) => byName.get(name(effect)) ?? [])
  const texts: string[] = [...presets]
  while (queue.length) {
    const shader = queue.pop()!
    if (used.has(shader)) continue
    used.add(shader)
    const text = await shader.read()
    texts.push(text)
    for (const include of text.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g)) queue.push(...byName.get(name(include[1])) ?? [])
  }
  // A texture is named in its effect's source, in a macro it defines, or in a preset's preprocessor definitions:
  // in a quoted string, or as a bare image name in a definition.
  const textureNames = new Set(texts.flatMap((text) => [
    ...[...text.matchAll(/"([^"\r\n]+)"/g)].map((m) => name(m[1].trim())),
    ...[...text.matchAll(/([\w\-. ()]+\.(?:png|jpe?g|bmp|dds|tga|cube))/gi)].map((m) => name(m[1].trim())),
  ]))
  const keep = (f: SourceFile) => used.has(f) || (isTexture(f.path) && textureNames.has(name(f.path)))
  const kept = files.filter((f) => inRoots(f) && keep(f)).map((f) => slashes(f.path).toLowerCase())
  const folder = (path: string) => slashes(path).toLowerCase().split('/').slice(0, -1).join('/') + '/'
  return files.filter((f) => {
    if (!inRoots(f)) return false
    if (keep(f)) return false
    // A licence or readme stays only while its folder still ships something.
    return !isLicence(f.path) || !kept.some((path) => path.startsWith(folder(f.path)))
  }).map((f) => f.path)
}
