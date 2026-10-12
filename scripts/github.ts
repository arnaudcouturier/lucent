import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand, type Command } from './command'
import type { ContentFile } from '../src/shared/manifest'
import type { ContentRelease, PublishHost } from './publish-content'

interface Release { id: number; tag_name: string; draft: boolean }
interface Asset { name: string; size: number; state: string; digest?: string | null }

/** Uses gh's authentication and pagination; never replaces an existing release asset. */
export function createGitHubHost(repository = 'arnaudcouturier/lucent', run: Command = runCommand): PublishHost {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Repository must be owner/name.')
  const endpoint = `repos/${repository}/releases`
  const tags = new Map<number, string>()
  const api = async (path: string, args: string[] = []) => JSON.parse(await run('gh', ['api', path, '--hostname', 'github.com', ...args]))
  const pages = async <T>(path: string): Promise<T[]> => (await api(`${path}?per_page=100`, ['--paginate', '--slurp']) as T[][]).flat()
  const change = async (path: string, method: string, body: unknown) => {
    const temporary = await mkdtemp(join(tmpdir(), 'lucent-github-'))
    try {
      const input = join(temporary, 'request.json')
      await writeFile(input, JSON.stringify(body))
      return await api(path, ['--method', method, '--input', input])
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }
  const files = async (id: number, tag: string): Promise<ContentFile[]> => {
    return (await pages<Asset>(`${endpoint}/${id}/assets`))
      .filter((a) => a.state === 'uploaded' && /^[a-f0-9]{64}$/.test(a.name))
      .map((a) => {
        if (a.digest && a.digest !== `sha256:${a.name}`) throw new Error(`Release ${tag} contains an incorrect digest for ${a.name}.`)
        return { sha256: a.name, size: a.size, release: tag }
      })
  }
  return {
    async listContentReleases() {
      const result: ContentRelease[] = []
      for (const r of await pages<Release>(endpoint)) {
        if (!/^content-\d{4}\.\d{2}\.\d{2}$/.test(r.tag_name)) continue
        result.push({ id: r.id, tag: r.tag_name, draft: r.draft, files: r.draft ? [] : await files(r.id, r.tag_name) })
      }
      return result
    },
    async createDraft(tag, content) {
      const body = [...content.changelog, '', 'Components and source tags:', ...content.components.map((c) => `- ${c.name} (${c.licence}): ${c.source}`)].join('\n')
      const release: Release = await change(endpoint, 'POST', { tag_name: tag, name: tag, body, draft: true, prerelease: content.channel === 'beta', make_latest: 'false' })
      tags.set(release.id, tag)
      return release.id
    },
    async upload(id, file) {
      const tag = tags.get(id)
      if (!tag) throw new Error(`Unknown draft release: ${id}`)
      await run('gh', ['release', 'upload', tag, file.stagedPath, '--repo', repository])
    },
    async publish(id) {
      await change(`${endpoint}/${id}`, 'PATCH', { draft: false, make_latest: 'false' })
    },
  }
}
