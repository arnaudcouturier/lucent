import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { publishContent } from './publish-content'
import { createGitHubHost } from './github'

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      manifest: { type: 'string', default: 'manifest.json' },
      repo: { type: 'string', default: 'arnaudcouturier/lucent' },
      'seven-zip': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log('Usage: npm run publish:content -- <publish.json> [--dry-run] [--manifest manifest.json] [--repo owner/repo] [--seven-zip path]\n\nDry run validates locally and prints the candidate manifest and uploads. It makes no GitHub calls.\nLive publication requires gh auth login; archives require 7-Zip. See docs/publishing.md.')
    return
  }
  if (positionals.length !== 1) throw new Error('Expected one publish.json input. Use --help for usage.')
  const result = await publishContent(resolve(positionals[0]), {
    manifestPath: resolve(values.manifest!), dryRun: values['dry-run'], sevenZip: values['seven-zip'],
    host: values['dry-run'] ? undefined : createGitHubHost(values.repo),
  })
  console.log(JSON.stringify({ mode: values['dry-run'] ? 'dry-run (offline; existing files inferred from the local manifest)' : 'published', release: result.release, uploads: result.uploads, manifest: JSON.parse(result.manifestText) }, null, 2))
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
