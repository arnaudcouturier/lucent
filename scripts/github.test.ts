import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createGitHubHost } from './github'
import type { Command } from './command'
import type { ContentVersion } from '../src/shared/manifest'

it('finds assets on every release page and keeps content drafts and publications out of Latest', async () => {
  const requests: Record<string, unknown>[] = []
  const hash = 'a'.repeat(64)
  const asset = { name: hash, size: 12, state: 'uploaded', digest: `sha256:${hash}` }
  const run: Command = async (executable, args) => {
    expect(executable).toBe('gh')
    if (args[1] === 'repos/owner/repo/releases?per_page=100') {
      expect(args).toContain('--paginate')
      return JSON.stringify([[{ id: 1, tag_name: 'app-v0.1.0', draft: false }], [{ id: 2, tag_name: 'content-2026.10.01', draft: false }]])
    }
    if (args[1] === 'repos/owner/repo/releases/2/assets?per_page=100') {
      expect(args).toContain('--paginate')
      return JSON.stringify([[], [asset]])
    }
    const input = args[args.indexOf('--input') + 1]
    requests.push(JSON.parse(await readFile(input, 'utf8')))
    return JSON.stringify({ id: 3 })
  }
  const host = createGitHubHost('owner/repo', run)
  expect(await host.listContentReleases()).toEqual([{ id: 2, tag: 'content-2026.10.01', draft: false, files: [{ sha256: hash, size: 12, release: 'content-2026.10.01' }] }])
  const content = { id: '2026.10.12', channel: 'beta', changelog: ['New shaders'], components: [{ name: 'OptiScaler', source: 'https://github.com/upstream/OptiScaler/tree/v5.0' }] } as ContentVersion
  const id = await host.createDraft('content-2026.10.12', content)
  await host.publish(id)
  expect(requests[0]).toMatchObject({ tag_name: 'content-2026.10.12', draft: true, prerelease: true, make_latest: 'false' })
  expect(requests[0].body).toContain('https://github.com/upstream/OptiScaler/tree/v5.0')
  expect(requests[1]).toMatchObject({ draft: false, make_latest: 'false' })
})
