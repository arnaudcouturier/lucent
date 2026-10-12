import { expect, it } from 'vitest'
import { announcedContent } from './updates'
import { TEST_CONTENT, TEST_MANIFEST } from '../platform/contentFixture'
import type { ContentVersion, Manifest } from '../shared/manifest'

const version = (id: string, patch: Partial<ContentVersion> = {}): ContentVersion => ({ ...TEST_CONTENT, id, ...patch })
const manifest = (...versions: ContentVersion[]): Manifest => ({ ...TEST_MANIFEST, versions })
const facts = { channel: 'stable' as const, tier: 'rtx-30-40', current: '2026.10.12', skipped: [] as string[], appVersion: '0.1.0' }

it('announces the newest Stable version newer than the current one', () => {
  const m = manifest(version('2026.10.12'), version('2026.11.02'), version('2026.11.20'), version('2026.12.01', { channel: 'beta' }))
  expect(announcedContent(m, facts)?.id).toBe('2026.11.20')
})

it('announces nothing when the current version is the newest', () => {
  expect(announcedContent(manifest(version('2026.09.01'), version('2026.10.12')), facts)).toBeNull()
})

it('passes over a skipped version to the newest one that isn’t', () => {
  const m = manifest(version('2026.10.12'), version('2026.11.02'), version('2026.11.20'))
  expect(announcedContent(m, { ...facts, skipped: ['2026.11.20'] })?.id).toBe('2026.11.02')
  expect(announcedContent(m, { ...facts, skipped: ['2026.11.20', '2026.11.02'] })).toBeNull()
})

it('ignores versions without a recipe for the deployed tier, or needing a newer app', () => {
  const noTier = version('2026.11.20', { tiers: { radeon: TEST_CONTENT.tiers.radeon } })
  const newerApp = version('2026.11.25', { minAppVersion: '0.2.0' })
  expect(announcedContent(manifest(version('2026.11.02'), noTier, newerApp), facts)?.id).toBe('2026.11.02')
})
