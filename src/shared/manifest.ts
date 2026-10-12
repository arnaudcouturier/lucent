// Shared by the app and the publish tool. No framework or Platform dependencies.
export const MANIFEST_SCHEMA_VERSION = 1

export type TierStatus = 'stable' | 'experimental' | 'community-verified'

export interface GpuMatchRule {
  /** Numeric PCI vendor ID, e.g. 4318 (0x10de) for NVIDIA. */
  vendorId: number
  /** Case-insensitive regular expressions. Any pattern may match the adapter name. */
  deviceNamePatterns: string[]
}

export interface Tier {
  id: string
  label: string
  status: TierStatus
  /** Rules are ORed; within a rule both vendor and name must match. Only the last tier is "any". */
  gpuMatch: GpuMatchRule[] | 'any'
  neuralRendering: boolean
  requiresReShade: boolean
}

export interface Manifest {
  schemaVersion: number
  tiers: Tier[]
}

export class ManifestError extends Error {
  constructor(readonly kind: 'invalid' | 'update-required', message: string, readonly schemaVersion?: number) {
    super(message)
    this.name = 'ManifestError'
  }
}

export function parseManifest(text: string): Manifest {
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    invalid('The manifest is not valid JSON.')
  }
  return validateManifest(value)
}

function invalid(message: string): never {
  throw new ManifestError('invalid', message)
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} must be an object.`)
  return value as Record<string, unknown>
}

function nonemptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${field} must be a nonempty string.`)
  return value
}

function matchRule(value: unknown): GpuMatchRule {
  const rule = object(value, 'GPU match rule')
  if (typeof rule.vendorId !== 'number' || !Number.isInteger(rule.vendorId) || rule.vendorId < 0 || rule.vendorId > 0xffff) {
    invalid('GPU match rule vendorId must be a PCI vendor ID (0–65535).')
  }
  if (!Array.isArray(rule.deviceNamePatterns) || !rule.deviceNamePatterns.length) invalid('GPU match rule needs device-name patterns.')
  const patterns = rule.deviceNamePatterns.map((p) => {
    const pattern = nonemptyString(p, 'Device-name pattern')
    try {
      new RegExp(pattern, 'i')
    } catch {
      invalid(`Invalid device-name pattern: ${pattern}`)
    }
    return pattern
  })
  return { vendorId: rule.vendorId, deviceNamePatterns: patterns }
}

function tier(value: unknown, last: boolean): Tier {
  const t = object(value, 'Tier')
  const id = nonemptyString(t.id, 'Tier id')
  const label = nonemptyString(t.label, 'Tier label')
  if (t.status !== 'stable' && t.status !== 'experimental' && t.status !== 'community-verified') invalid(`Invalid tier status: ${id}`)
  if (typeof t.neuralRendering !== 'boolean' || typeof t.requiresReShade !== 'boolean') invalid(`Tier capabilities must be booleans: ${id}`)
  let gpuMatch: Tier['gpuMatch']
  if (last) {
    if (t.gpuMatch !== 'any') invalid('The last tier must match any GPU.')
    gpuMatch = 'any'
  } else {
    if (!Array.isArray(t.gpuMatch) || !t.gpuMatch.length) invalid(`Tier needs GPU match rules: ${id}`)
    gpuMatch = t.gpuMatch.map(matchRule)
  }
  return { id, label, status: t.status, gpuMatch, neuralRendering: t.neuralRendering, requiresReShade: t.requiresReShade }
}

/** Validates an object too, so the publish tool can validate before serializing. */
export function validateManifest(value: unknown): Manifest {
  const m = object(value, 'Manifest')
  if (typeof m.schemaVersion !== 'number' || !Number.isSafeInteger(m.schemaVersion) || m.schemaVersion < 1) invalid('Invalid manifest schema version.')
  // Read the envelope before the versioned contents. A future schema may change the tier structure.
  if (m.schemaVersion > MANIFEST_SCHEMA_VERSION) {
    throw new ManifestError('update-required', 'This content needs a newer Lucent app. Update Lucent to continue.', m.schemaVersion)
  }
  if (!Array.isArray(m.tiers) || !m.tiers.length) invalid('The manifest needs tiers.')
  const tiers = m.tiers.map((t, i, all) => tier(t, i === all.length - 1))
  if (new Set(tiers.map((t) => t.id)).size !== tiers.length) invalid('Tier ids must be unique.')
  return { schemaVersion: m.schemaVersion, tiers }
}
