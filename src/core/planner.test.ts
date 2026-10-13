import { expect, it } from 'vitest'
import { planDeployment } from './planner'
import { TEST_CONTENT, TEST_MANIFEST, OPTISCALER_HASH } from '../platform/contentFixture'

it('plans the final file count and downloads once per hash, including optional ReShade', () => {
  const scan = { files: [], ownedFiles: [], cachedFiles: [OPTISCALER_HASH] }
  const plan = planDeployment(TEST_CONTENT, TEST_MANIFEST.tiers[1], true, scan)
  expect(plan.counts).toEqual({ added: 5, backedUp: 0, downloads: 4 })
  expect(plan.downloadSize).toBe(41)
  expect(plan.steps).toHaveLength(6)
  expect(planDeployment(TEST_CONTENT, TEST_MANIFEST.tiers[1], false, scan).counts).toEqual({ added: 1, backedUp: 0, downloads: 0 })
})

it('counts originals once across rename, overwrite and delete, while protecting unowned files', () => {
  const content = { ...TEST_CONTENT, tiers: { ...TEST_CONTENT.tiers, 'rtx-30-40': {
    ...TEST_CONTENT.tiers['rtx-30-40'], ownedConfigs: [], shippedPresets: [], recipe: [
      { kind: 'rename' as const, from: 'old.dll', to: 'winmm.dll' },
      { kind: 'copy' as const, file: OPTISCALER_HASH, to: 'winmm.dll' },
      { kind: 'delete' as const, path: 'obsolete.ini' },
    ],
  } } }
  const plan = planDeployment(content, TEST_MANIFEST.tiers[1], false, { files: ['OLD.DLL', 'obsolete.ini', 'User.ini'], ownedFiles: ['old.dll', 'obsolete.ini'], cachedFiles: [] })
  expect(plan.counts).toEqual({ added: 1, backedUp: 2, downloads: 1 })
  expect(plan.filesToBackup).toEqual(['old.dll', 'obsolete.ini'])
  expect(plan.unclaimedPaths).toEqual([])
  expect(plan.expectedFiles).toEqual([{ path: 'winmm.dll', sha256: OPTISCALER_HASH }])
})
