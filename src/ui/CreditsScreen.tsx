import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { creditsVersion } from '../core/credits'
import { useCore } from './useCore'

const AUTHORS = [
  {
    group: 'OptiScaler forks',
    people: [
      { name: 'SirenBrink', url: 'https://github.com/SirenBrink/OptiScaler_DLSSNR_Multipass_MFG_FFXIV' },
      { name: 'y4my4my4m', url: 'https://github.com/y4my4my4m/OptiScaler_DLSSNR_Multipass_MFG' },
      { name: 'Dagherbou', url: 'https://github.com/Dagherbou/OptiScaler_DLSSNR' },
    ],
  },
  { group: 'AMD FidelityFX', people: [{ name: 'AMD', url: 'https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK' }] },
  { group: 'Intel XeSS', people: [{ name: 'Intel', url: 'https://github.com/intel/xess' }] },
  { group: 'Compatibility runtime', people: [{ name: 'ShortFuse / RenoDX', url: 'https://github.com/clshortfuse/renodx' }] },
  { group: 'ReShade', people: [{ name: 'crosire', url: 'https://reshade.me/' }] },
  {
    group: 'iMMERSE & qUINT',
    people: [
      { name: 'Marty McFly', url: 'https://github.com/martymcmodding/iMMERSE' },
      { name: 'qUINT', url: 'https://github.com/martymcmodding/qUINT' },
    ],
  },
  { group: 'SweetFX', people: [{ name: 'CeeJay.dk & contributors', url: 'https://github.com/CeeJayDK/SweetFX' }] },
  { group: 'Alive presets', people: [{ name: 'Wafflezs', url: 'https://www.nexusmods.com/finalfantasy14/mods/156' }] },
  { group: 'ipsuShade', people: [{ name: 'ipsusu', url: 'https://github.com/ipsusu/ipsuShade' }] },
]

/** Upstream authors and the components of the installed content, with links to their sources. */
export function Credits() {
  const [state, core] = useCore()
  const [opening, setOpening] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const tier = state.deployment?.tier ?? (state.graphics.status === 'found' ? state.graphics.tier?.id ?? null : null)
  const version = creditsVersion(state.manifest, state.deployment, tier, state.channel)

  const openLink = async (url: string) => {
    setOpening(url)
    setLinkError(null)
    try { await core.openLink(url) }
    catch (error) { setLinkError(error instanceof Error ? error.message : String(error)) }
    finally { setOpening(null) }
  }
  const linkDisabled = state.busy || opening !== null

  return <div className="credits">
      {linkError && <div className="credits-message is-error" role="alert">{linkError}</div>}

      <section className="credits-section" aria-labelledby="upstream-credits-title">
        <h2 id="upstream-credits-title">Upstream authors</h2>
        <dl className="card credits-authors">
          {AUTHORS.map(({ group, people }) => <div className="credits-author" key={group}>
            <dt>{group}</dt>
            <dd>{people.map((person, index) => <span className="credits-person" key={person.name}>
              {index > 0 && <span aria-hidden="true"> · </span>}
              <button className="text-link" disabled={linkDisabled} onClick={() => void openLink(person.url)}>{person.name}<ExternalLink size={14} strokeWidth={1.75} /></button>
            </span>)}</dd>
          </div>)}
        </dl>
      </section>

      <section className="credits-section" aria-labelledby="content-components-title">
        <div className="credits-section-heading">
          <h2 id="content-components-title">Components in this content</h2>
          {version && <span className="credits-version mono">{version.id}</span>}
        </div>
        {version ? version.components.length ? <ul className="list credits-components">
          {version.components.map((component) => <li className="card credits-component" key={`${component.name}:${component.source}`}>
            <h3>{component.name}</h3>
            <dl>
              <div><dt>Upstream</dt><dd>{component.upstream}</dd></div>
              <div><dt>Licence</dt><dd>{component.licence}</dd></div>
            </dl>
            <button className="text-link credits-source" aria-label={`Open source for ${component.name}`} title={component.source} disabled={linkDisabled} onClick={() => void openLink(component.source)}>
              <span>{component.source}</span> <ExternalLink size={14} strokeWidth={1.75} />
            </button>
          </li>)}
        </ul> : <p className="credits-empty">Content {version.id} does not list component details yet.</p>
        : state.manifest.status === 'idle' || state.manifest.status === 'loading'
          ? <p className="credits-empty">The content manifest is still loading. Upstream author credits are available above.</p>
          : state.manifest.status === 'ready'
            ? state.deployment
              ? <p className="credits-empty">Component details for deployed content {state.deployment.contentVersion} are unavailable because that version is not in the current manifest. Upstream author credits are available above.</p>
              : <p className="credits-empty">No published content version matches this tier yet. Upstream author credits are available above.</p>
            : <p className="credits-empty">The content manifest is unavailable. Upstream author credits are available above.</p>}
      </section>
  </div>
}
