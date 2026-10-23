// The output folder of a candidate build is emptied at the start of each run, so it has to be a folder the script
// made itself, and never one that holds what the build reads.
import { lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Written into the output folder by every run; a folder without it, and with something in it, is not the script's to empty. */
export const OUTPUT_MARKER = '.lucent-candidate-output'

/** Whether `inner` is `outer` or inside it, by path alone. */
function within(outer: string, inner: string): boolean {
  const path = relative(outer, inner)
  return path === '' || !(path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
}

const real = (path: string) => realpath(path).catch(() => resolve(path))

/**
 * Gets `output` ready for a build: made if it is absent, emptied if an earlier run made it, refused if it holds anything
 * else. A folder that is, or holds, one of `inputs` is refused whatever it holds, because emptying it would delete them.
 */
export async function prepareOutputFolder(output: string, inputs: readonly string[]): Promise<void> {
  const target = resolve(output)
  const found = await lstat(target).catch(() => null)
  const targets = found ? [target, await real(target)] : [target]
  for (const input of inputs) {
    const paths = [resolve(input), await real(input)]
    if (targets.some((folder) => paths.some((path) => within(folder, path)))) {
      throw new Error(`The output folder ${target} is, or holds, an input of this build (${input}). Choose a folder of its own.`)
    }
  }
  if (found) {
    if (!found.isDirectory()) throw new Error(`The output ${target} is not a plain folder.`)
    const entries = await readdir(target)
    const marker = entries.includes(OUTPUT_MARKER) && (await lstat(join(target, OUTPUT_MARKER))).isFile()
    if (entries.length && !marker) {
      throw new Error(`The output folder ${target} is not empty and an earlier run did not make it, so it is left alone. Choose a new folder, or empty this one yourself.`)
    }
    await rm(target, { recursive: true, force: true })
  }
  await mkdir(target, { recursive: true })
  await writeFile(join(target, OUTPUT_MARKER), 'Made by a candidate build, which empties this folder at the start of its next run.\n')
}
