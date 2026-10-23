import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OUTPUT_MARKER, prepareOutputFolder } from './candidate-output'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'lucent-output-test-'))
  temporary.push(root)
  const zip = join(root, 'inputs', 'fork.zip')
  const folder = join(root, 'inputs', 'runtimes')
  await mkdir(folder, { recursive: true })
  await writeFile(zip, 'zip')
  await writeFile(join(folder, 'nvngx_dlssnr.dll'), 'dll')
  return { root, zip, folder, inputs: [zip, folder] }
}

describe('the candidate output folder', () => {
  it('is made, with a marker, when it does not exist yet', async () => {
    const { root, inputs } = await workspace()
    const output = join(root, 'new', 'candidate')
    await prepareOutputFolder(output, inputs)
    expect(await readdir(output)).toEqual([OUTPUT_MARKER])
  })

  it('may be an existing empty folder', async () => {
    const { root, inputs } = await workspace()
    const output = join(root, 'empty')
    await mkdir(output)
    await prepareOutputFolder(output, inputs)
    expect(await readdir(output)).toEqual([OUTPUT_MARKER])
  })

  it('is emptied when an earlier run made it', async () => {
    const { root, inputs } = await workspace()
    const output = join(root, 'candidate')
    await prepareOutputFolder(output, inputs)
    await mkdir(join(output, 'sources', 'deep'), { recursive: true })
    await writeFile(join(output, 'sources', 'deep', 'old.dll'), 'old')
    await prepareOutputFolder(output, inputs)
    expect(await readdir(output)).toEqual([OUTPUT_MARKER])
  })

  it('is refused, and left as it was, when it holds files this script did not make', async () => {
    const { root, inputs } = await workspace()
    const output = join(root, 'precious')
    await mkdir(output)
    await writeFile(join(output, 'mine.txt'), 'keep')
    await expect(prepareOutputFolder(output, inputs)).rejects.toThrow(/not empty.*left alone/)
    expect(await readdir(output)).toEqual(['mine.txt'])
    expect(await readFile(join(output, 'mine.txt'), 'utf8')).toBe('keep')
  })

  it('is refused when its marker is a folder rather than the file a run writes', async () => {
    const { root, inputs } = await workspace()
    const output = join(root, 'impostor')
    await mkdir(join(output, OUTPUT_MARKER), { recursive: true })
    await writeFile(join(output, 'mine.txt'), 'keep')
    await expect(prepareOutputFolder(output, inputs)).rejects.toThrow(/not empty/)
    expect(await readFile(join(output, 'mine.txt'), 'utf8')).toBe('keep')
  })

  it('is refused when it is a file', async () => {
    const { root, inputs } = await workspace()
    const output = join(root, 'a-file')
    await writeFile(output, 'x')
    await expect(prepareOutputFolder(output, inputs)).rejects.toThrow(/not a plain folder/)
    expect(await readFile(output, 'utf8')).toBe('x')
  })

  it('is refused when it is an input folder, even one carrying the marker', async () => {
    const { folder, inputs } = await workspace()
    await writeFile(join(folder, OUTPUT_MARKER), 'marker')
    await expect(prepareOutputFolder(folder, inputs)).rejects.toThrow(/is, or holds, an input/)
    expect(await readFile(join(folder, 'nvngx_dlssnr.dll'), 'utf8')).toBe('dll')
  })

  it('is refused when it holds an input file or folder, and names the input', async () => {
    const { root, zip, folder, inputs } = await workspace()
    const holder = join(root, 'inputs')
    await writeFile(join(holder, OUTPUT_MARKER), 'marker')
    await expect(prepareOutputFolder(holder, inputs)).rejects.toThrow(zip)
    expect(await readFile(zip, 'utf8')).toBe('zip')
    await expect(prepareOutputFolder(root, inputs)).rejects.toThrow(/is, or holds, an input/)
    expect(await readFile(join(folder, 'nvngx_dlssnr.dll'), 'utf8')).toBe('dll')
  })

  it('may sit inside an input folder or beside the inputs without touching them', async () => {
    const { root, folder, inputs } = await workspace()
    await prepareOutputFolder(join(root, 'inputs-next'), inputs)
    await prepareOutputFolder(join(folder, 'out'), inputs)
    expect(await readFile(join(folder, 'nvngx_dlssnr.dll'), 'utf8')).toBe('dll')
  })

  it('does not mistake a folder whose name only starts like another for one that holds it', async () => {
    const { root } = await workspace()
    await prepareOutputFolder(join(root, 'inputs..more'), [join(root, 'inputs')])
    await prepareOutputFolder(join(root, 'inputs-extra'), [join(root, 'inputs')])
  })

  it.skipIf(process.platform !== 'win32')('compares paths without regard to case on Windows', async () => {
    const { root, folder, inputs } = await workspace()
    await expect(prepareOutputFolder(folder.toUpperCase(), inputs)).rejects.toThrow(/is, or holds, an input/)
    await expect(prepareOutputFolder(join(root, 'INPUTS'), inputs)).rejects.toThrow(/is, or holds, an input/)
  })

  it('is refused when a link leads it to an input folder', async () => {
    const { root, folder, inputs } = await workspace()
    const link = join(root, 'link')
    try { await symlink(folder, link, 'junction') } catch { return }
    await expect(prepareOutputFolder(link, inputs)).rejects.toThrow(/is, or holds, an input|not a plain folder/)
    expect(await readFile(join(folder, 'nvngx_dlssnr.dll'), 'utf8')).toBe('dll')
  })
})
