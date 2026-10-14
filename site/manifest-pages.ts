// Build-time content for the site, read from manifest.json, so the pages say exactly what Lucent installs:
// the components of the newest content version, which graphics cards have content, and every file by path.
import { readFileSync } from 'node:fs'
import { parseManifest, type ContentVersion, type Manifest, type Step, type Tier } from '../src/shared/manifest.ts'

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const count = (n: number) => n.toLocaleString('en')
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
const assetUrl = (release: string, sha256: string) => `https://github.com/arnaudcouturier/lucent/releases/download/${release}/${sha256}`

/** What each tier deploys, in the player's words. Tiers are data; an unknown one falls back to its flags. */
const TIER_OFFER: Record<string, string> = {
  'rtx-50': 'DLSS 5 Neural Rendering with NVIDIA’s runtime, plus ReShade',
  'rtx-30-40': 'DLSS 5 Neural Rendering through the compatibility runtime, plus ReShade',
  'rtx-20': 'DLSS 5 Neural Rendering through the compatibility runtime, plus ReShade',
  radeon: 'FSR upscaling and frame generation, plus ReShade',
  other: 'ReShade with every preset',
}
const STATUS: Record<Tier['status'], string> = { stable: 'Stable', experimental: 'Experimental', 'community-verified': 'Community-verified' }

const newestFirst = (versions: ContentVersion[]) => [...versions].sort((a, b) => b.id.localeCompare(a.id))

/** The total size of the distinct files a tier's recipe copies. */
function tierFiles(version: ContentVersion, tierId: string) {
  const hashes = new Set(version.tiers[tierId].recipe.filter((s) => s.kind === 'copy').map((s) => (s as Extract<Step, { kind: 'copy' }>).file))
  const files = version.files.filter((f) => hashes.has(f.sha256))
  return { files: version.tiers[tierId].recipe.filter((s) => s.kind === 'copy').length, bytes: files.reduce((sum, f) => sum + f.size, 0) }
}

function components(manifest: Manifest) {
  const version = newestFirst(manifest.versions)[0]
  if (!version) return '<p class="muted">No content is published yet.</p>'
  return `<ul class="component-grid">${version.components.map((c) => `
    <li class="component"><span class="component-name">${escape(c.name)}</span><span class="component-by">${escape(c.upstream)}</span>
      <span class="component-meta"><span class="tag">${escape(c.licence)}</span><a href="${escape(c.source)}">Source <span aria-hidden="true">↗</span></a></span></li>`).join('')}
  </ul>`
}

function fileSummary(manifest: Manifest) {
  const version = newestFirst(manifest.versions)[0]
  if (!version) return 'No content is published yet.'
  const tier = Object.keys(version.tiers)[0]
  const { files, bytes } = tierFiles(version, tier)
  return `Content ${escape(version.id)} · ${count(files)} files · ${size(bytes)}`
}

function tiers(manifest: Manifest) {
  const rows = manifest.tiers.map((tier) => {
    const versions = manifest.versions.filter((v) => v.tiers[tier.id])
    const availability = versions.some((v) => v.channel === 'stable') ? '<span class="tag is-accent">Available</span>'
      : versions.length ? '<span class="tag is-accent">In Beta</span>' : '<span class="tag">Coming</span>'
    const offer = TIER_OFFER[tier.id] ?? (tier.neuralRendering ? 'DLSS 5 Neural Rendering, plus ReShade' : 'ReShade with every preset')
    return `<li class="tier-row"><span class="tier-name">${escape(tier.gpuMatch === 'any' ? 'Any other card' : tier.label)}</span>
      <span class="tier-offer">${escape(offer)}</span>
      <span class="tier-tags"><span class="tag ${tier.status === 'experimental' ? 'is-caution' : ''}">${STATUS[tier.status]}</span>${availability}</span></li>`
  })
  return `<ul class="tier-list">${rows.join('')}</ul>`
}

interface TreeNode { folders: Map<string, TreeNode>; rows: string[]; total: number }
const node = (): TreeNode => ({ folders: new Map(), rows: [], total: 0 })

function stepRow(step: Step, version: ContentVersion): { path: string; html: string } {
  const reshade = step.when === 'reshade' ? '<span class="tag">With ReShade</span>' : ''
  if (step.kind === 'copy') {
    const file = version.files.find((f) => f.sha256 === step.file)
    const name = step.to.split('/').pop()!
    const hash = file ? `<a class="file-hash" href="${assetUrl(file.release, file.sha256)}" title="SHA-256 ${file.sha256}">${file.sha256.slice(0, 12)}…</a>` : `<span class="file-hash">${step.file.slice(0, 12)}…</span>`
    return { path: step.to, html: `<li class="file-row" data-path="${escape(step.to.toLowerCase())}"><span class="file-name">${escape(name)}</span>${reshade}<span class="file-size">${file ? size(file.size) : ''}</span>${hash}</li>` }
  }
  const text = step.kind === 'rename' ? `Renames ${step.from} to ${step.to}` : step.kind === 'delete' ? `Removes ${step.path}` : `Sets [${step.section}] ${step.key} = ${step.value} in ${step.file}`
  const path = step.kind === 'rename' ? step.to : step.kind === 'delete' ? step.path : step.file
  return { path, html: `<li class="file-row is-step" data-path="${escape(path.toLowerCase())}"><span class="file-name">${escape(text)}</span>${reshade}</li>` }
}

function renderTree(tree: TreeNode, depth: number): string {
  const folders = [...tree.folders.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) =>
    `<li><details${depth === 0 && child.total < 60 ? ' open' : ''}><summary><span class="file-folder">${escape(name)}/</span><span class="file-count">${count(child.total)}</span></summary><ul>${renderTree(child, depth + 1)}</ul></details></li>`)
  return folders.join('') + tree.rows.join('')
}

function files(manifest: Manifest) {
  if (!manifest.versions.length) return '<p class="muted">No content is published yet.</p>'
  return newestFirst(manifest.versions).map((version) => {
    const tierSections = Object.keys(version.tiers).map((tierId) => {
      const tier = manifest.tiers.find((t) => t.id === tierId)
      const root = node()
      for (const step of version.tiers[tierId].recipe) {
        const { path, html } = stepRow(step, version)
        const parts = path.split('/')
        let at = root
        at.total++
        for (const part of parts.slice(0, -1)) {
          if (!at.folders.has(part)) at.folders.set(part, node())
          at = at.folders.get(part)!
          at.total++
        }
        at.rows.push(html)
      }
      const { files, bytes } = tierFiles(version, tierId)
      return `<section class="file-tier"><h3>${escape(tier?.label ?? tierId)} <span class="muted">· ${count(files)} files · ${size(bytes)}</span></h3><ul class="file-tree">${renderTree(root, 0)}</ul></section>`
    }).join('')
    const releases = [...new Set(version.files.map((f) => f.release))]
    return `<section class="file-version" id="content-${escape(version.id)}">
      <header class="file-version-head"><h2>Content ${escape(version.id)}</h2><span class="tag ${version.channel === 'beta' ? 'is-caution' : 'is-accent'}">${version.channel === 'beta' ? 'Beta' : 'Stable'}</span></header>
      ${version.changelog.length ? `<ul class="file-changelog">${version.changelog.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>` : ''}
      <p class="muted">Downloaded from ${releases.map((r) => `<a href="https://github.com/arnaudcouturier/lucent/releases/tag/${escape(r)}">${escape(r)}</a>`).join(', ')}.</p>
      ${tierSections}
    </section>`
  }).join('')
}

/** Placeholder comment → generated HTML, for the site's pages. */
export function manifestPlaceholders(manifestPath: string): Record<string, string> {
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'))
  return {
    '<!-- lucent:components -->': components(manifest),
    '<!-- lucent:file-summary -->': fileSummary(manifest),
    '<!-- lucent:tiers -->': tiers(manifest),
    '<!-- lucent:files -->': files(manifest),
  }
}
