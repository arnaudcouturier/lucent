// PROTOTYPE Variant A, "Prism": the crystal is the identity. One centred column, the crystal's light
// is the status, Windows 11 Mica behind everything, slow luminous motion, Instrument Serif + Sans.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CheckIcon, DotsThreeIcon, MinusIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import { installPhase, useLucent, useScanProgress, useTimedProgress, type Lucent } from '../../lucent/store'
import {
  APP_VERSION,
  CHANGELOG,
  CUSTOM,
  DRIFT,
  EXISTING_SETUP,
  FIRST_RUN,
  GAME,
  LAUNCHER,
  NEXT_CONTENT_VERSION,
  PROFILES,
  fmt,
  profileLabel,
  profileText,
} from '../../lucent/data'
import { Crystal, type CrystalMode } from './Crystal'
import './prism.css'

const EASE = [0.22, 1, 0.36, 1] as const

export function Prism() {
  const l = useLucent()
  const s = l.screen
  const resolved = useScanProgress(s === 'scan', 650, 700)
  const installP = useTimedProgress(5600, () => l.go('done'), s === 'install')

  const mainMode: CrystalMode = !l.enabled ? 'glass' : l.busy ? 'lit' : l.health === 'drift' ? 'drift' : l.health === 'update' ? 'update' : 'lit'
  const hero: Record<typeof s, { h: number; mode: CrystalMode; fill?: number }> = {
    scan: { h: 150, mode: resolved < 4 ? 'scan' : 'glass' },
    profile: { h: 0, mode: 'glass' },
    review: { h: 128, mode: 'glass' },
    install: { h: 236, mode: 'fill', fill: installP },
    done: { h: 196, mode: 'flare' },
    main: { h: 230, mode: mainMode },
  }
  const c = hero[s]
  const glow = c.mode === 'glass' || c.mode === 'scan' ? 0.25 : c.mode === 'fill' ? 0.3 + installP * 0.7 : 1

  return (
    <div className="pz">
      <div className="pz-spill" style={{ opacity: glow }} />
      <div className="pz-spill pz-spill-amber" style={{ opacity: c.mode === 'drift' ? 0.9 : 0 }} />
      <TitleBar />
      <div className="pz-body">
        <motion.div
          className="pz-hero"
          initial={false}
          animate={{ height: c.h, opacity: c.h ? 1 : 0, marginTop: s === 'main' ? 22 : 4 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <Crystal height={Math.max(c.h, 1)} mode={c.mode} fill={c.fill} busy={!!l.busy} />
        </motion.div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={s}
            className="pz-screen"
            initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            {s === 'scan' && <ScanView resolved={resolved} />}
            {s === 'profile' && <ProfileView />}
            {s === 'review' && <ReviewView />}
            {s === 'install' && <InstallView p={installP} />}
            {s === 'done' && <DoneView />}
            {s === 'main' && <MainView />}
          </motion.div>
        </AnimatePresence>
      </div>
      <Changelog />
      <Toast />
    </div>
  )
}

function Mark() {
  return (
    <svg className="pz-mark" viewBox="0 0 16 22" aria-hidden>
      <polygon points="8,0 16,8 8,22 0,8" fill="url(#pzmark)" />
      <path d="M0 8 L6 10 L8 22 M6 10 L16 8" fill="none" stroke="#e6f8ff" strokeOpacity=".55" strokeWidth=".8" />
      <defs>
        <linearGradient id="pzmark" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#bfeaff" />
          <stop offset="1" stopColor="#2f6bff" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function TitleBar() {
  const l = useLucent()
  const step = FIRST_RUN.indexOf(l.screen)
  return (
    <div className="pz-title" data-tauri-drag-region>
      <div className="pz-brand">
        <Mark />
        Lucent
      </div>
      {step >= 0 && (
        <div className="pz-steps" aria-label={`Step ${step + 1} of ${FIRST_RUN.length}`}>
          {FIRST_RUN.map((k, i) => (
            <span key={k} className={`pz-step ${i < step ? 'is-done' : ''} ${i === step ? 'is-now' : ''}`} />
          ))}
        </div>
      )}
      <div className="pz-caption">
        <button aria-label="Minimize">
          <MinusIcon size={14} weight="light" />
        </button>
        <button className="pz-close" aria-label="Close">
          <XIcon size={14} weight="light" />
        </button>
      </div>
    </div>
  )
}

function TierChip({ l }: { l: Lucent }) {
  const st = l.gpu.tierStatus
  return (
    <span className="pz-tier">
      {l.gpu.tier}
      {st !== 'Stable' && <span className={`pz-badge ${st === 'Experimental' ? 'is-exp' : 'is-comm'}`}>{st}</span>}
    </span>
  )
}

function Footer({ back, next, onNext, disabled }: { back?: () => void; next: string; onNext: () => void; disabled?: boolean }) {
  return (
    <div className="pz-footer">
      {back ? (
        <button className="pz-ghost" onClick={back}>
          Back
        </button>
      ) : (
        <span />
      )}
      <button className="pz-primary" onClick={onNext} disabled={disabled}>
        {next}
      </button>
    </div>
  )
}

/* ---------- First run ---------- */

function ScanView({ resolved }: { resolved: number }) {
  const l = useLucent()
  const ex = l.scenario.existing
  const rows: { label: string; value: ReactNode; detail: ReactNode; warn?: boolean }[] = [
    { label: 'Game folder', value: `${GAME.source} · ${GAME.version}`, detail: GAME.folderShort },
    { label: 'Graphics card', value: l.gpu.name, detail: <TierChip l={l} /> },
    { label: 'Launcher', value: LAUNCHER.name, detail: LAUNCHER.note },
    ex
      ? {
          label: 'Existing setup',
          value: EXISTING_SETUP.name,
          detail: `${EXISTING_SETUP.fileCount} files will be backed up and replaced. Your ${EXISTING_SETUP.presetsKept} presets are kept.`,
          warn: true,
        }
      : { label: 'Existing setup', value: 'None', detail: 'Nothing to back up' },
  ]
  const done = resolved >= 4
  return (
    <div className="pz-col">
      <h1 className="pz-h1">{!done ? 'Looking for your game' : ex ? 'Found your game, and an old setup' : 'Found everything'}</h1>
      <ul className="pz-checks">
        {rows.map((r, i) => {
          const st = i < resolved ? (r.warn ? 'warn' : 'ok') : i === resolved ? 'busy' : 'wait'
          return (
            <li key={r.label} className={`pz-check is-${st}`}>
              <span className="pz-check-glyph">
                {st === 'ok' && <CheckIcon size={12} weight="bold" />}
                {st === 'warn' && <WarningIcon size={12} weight="bold" />}
              </span>
              <span className="pz-check-label">{r.label}</span>
              <span className="pz-check-value">
                <span>{i < resolved ? r.value : '…'}</span>
                {i < resolved && <span className="pz-check-detail">{r.detail}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      <Footer next="Continue" disabled={!done} onNext={() => l.go('profile')} />
    </div>
  )
}

function Meter({ label, n }: { label: string; n: number }) {
  return (
    <span className="pz-meter">
      {label}
      <span>
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= n ? 'on' : ''} />
        ))}
      </span>
    </span>
  )
}

function ProfileView() {
  const l = useLucent()
  const sel = l.profile === 'custom' ? CUSTOM.base : l.profile
  return (
    <div className="pz-col pz-col-profile">
      <h1 className="pz-h1">Choose a performance profile</h1>
      <p className="pz-sub">The only choice to make. You can change it any time.</p>
      <div className="pz-cards" role="radiogroup" aria-label="Performance profile">
        {PROFILES.map((p) => {
          const on = sel === p.key
          return (
            <button key={p.key} role="radio" aria-checked={on} className={`pz-card ${on ? 'is-on' : ''}`} onClick={() => l.setProfile(p.key)}>
              {p.key === 'balanced' && <span className="pz-reco">Recommended</span>}
              <Crystal height={58} mode={on ? 'lit' : 'glass'} />
              <span className="pz-card-title">{p.label}</span>
              <span className="pz-card-text">{profileText(p, l.gpu)}</span>
              <span className="pz-meters">
                <Meter label="Image" n={p.image} />
                <Meter label="Speed" n={p.speed} />
              </span>
            </button>
          )
        })}
      </div>
      <Footer back={() => l.go('scan')} next="Continue" onNext={() => l.go('review')} />
    </div>
  )
}

function Check({ on, set, label, note, locked }: { on: boolean; set?: (v: boolean) => void; label: string; note?: string; locked?: boolean }) {
  return (
    <label className={`pz-checkbox ${locked ? 'is-locked' : ''}`}>
      <input type="checkbox" checked={on} disabled={locked} onChange={(e) => set?.(e.target.checked)} />
      <span className="pz-box">{on && <CheckIcon size={11} weight="bold" />}</span>
      <span>
        {label}
        {note && <em>{note}</em>}
      </span>
    </label>
  )
}

function ReviewView() {
  const l = useLucent()
  const n = l.numbers
  return (
    <div className="pz-col">
      <h1 className="pz-h1">Ready to install</h1>
      <div className="pz-stats">
        <div>
          <b>{fmt(n.backedUp)}</b>
          <span>files backed up</span>
        </div>
        <div>
          <b>{fmt(n.added)}</b>
          <span>files added</span>
        </div>
        <div>
          <b>
            {n.downloadMb}
            <small> MB</small>
          </b>
          <span>to download</span>
        </div>
      </div>
      {l.scenario.existing && (
        <p className="pz-note is-warn">
          <WarningIcon size={13} weight="bold" /> {EXISTING_SETUP.name} are backed up, then replaced. Your {EXISTING_SETUP.presetsKept} presets are kept.
        </p>
      )}
      <div className="pz-options">
        <Check
          on={l.includeReshade}
          set={l.setIncludeReshade}
          label="Include ReShade"
          locked={l.gpu.reshadeRequired}
          note={l.gpu.reshadeRequired ? 'Always included on Radeon' : undefined}
        />
        <Check on={l.startMenu} set={l.setStartMenu} label="Add Lucent to the Start menu" />
      </div>
      <Footer back={() => l.go('profile')} next="Install" onNext={() => l.go('install')} />
    </div>
  )
}

function InstallView({ p }: { p: number }) {
  const l = useLucent()
  const ph = installPhase(p, l)
  const label =
    ph.index === 0 ? (
      <>
        Downloading {ph.current.name} · {ph.downloadedMb} of {ph.total} MB
      </>
    ) : (
      ph.steps[ph.index].label
    )
  return (
    <div className="pz-col">
      <h1 className="pz-h1 pz-pct">{Math.round(p * 100)}%</h1>
      <p className="pz-sub">{label}</p>
    </div>
  )
}

function DoneView() {
  const l = useLucent()
  return (
    <div className="pz-col">
      <h1 className="pz-h1">You're set</h1>
      <p className="pz-sub">Start the game as usual. {l.hotkeys.length > 1 ? 'Two keys' : 'One key'} to remember:</p>
      <div className="pz-keys">
        {l.hotkeys.map((h) => (
          <div key={h.key} className="pz-key">
            <kbd>{h.key}</kbd>
            <span>
              <b>{h.what}</b>
              <em>{h.hint}</em>
            </span>
          </div>
        ))}
      </div>
      {l.startMenu && <p className="pz-fine">Lucent is now in your Start menu.</p>}
      <Footer next="Finish" onNext={() => l.go('main')} />
    </div>
  )
}

/* ---------- Main ---------- */

function status(l: Lucent): { title: ReactNode; sub: ReactNode; action?: { label: string; run: () => void } } {
  const pct = Math.round(l.busyProgress * 100)
  if (l.busy === 'repair') return { title: 'Repairing', sub: `Restoring ${DRIFT.files} files · ${pct}%` }
  if (l.busy === 'update')
    return { title: 'Updating', sub: `Content ${NEXT_CONTENT_VERSION} · ${Math.round(l.busyProgress * CHANGELOG.mb)} of ${CHANGELOG.mb} MB` }
  const repair = l.health === 'drift' ? { label: 'Repair', run: l.repair } : undefined
  if (!l.enabled)
    return { title: 'Disabled', sub: 'The game runs without mods. Everything stays in place.', action: repair }
  if (l.health === 'drift')
    return {
      title: (
        <>
          <i>{DRIFT.files} files</i> need repair
        </>
      ),
      sub: `Game patch ${DRIFT.patch} replaced them.`,
      action: repair,
    }
  if (l.health === 'update')
    return {
      title: (
        <>
          Content <i>{NEXT_CONTENT_VERSION}</i> is out
        </>
      ),
      sub: `${CHANGELOG.changes.length} changes · ${CHANGELOG.mb} MB`,
      action: { label: 'Update', run: l.openChangelog },
    }
  return { title: 'Ready', sub: null }
}

function MainView() {
  const l = useLucent()
  const st = status(l)
  return (
    <div className="pz-col pz-main">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={String(l.busy) + l.health + l.enabled}
          className="pz-status"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          <h1 className="pz-h1 pz-h1-main">{st.title}</h1>
          <p className="pz-sub">
            {st.sub ?? (
              <>
                <TierChip l={l} /> <span className="pz-dot" /> Content {l.contentVersion} <span className="pz-dot" /> Checked just now
              </>
            )}
          </p>
          {st.action && (
            <button className="pz-primary pz-action" onClick={st.action.run}>
              {st.action.label}
            </button>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="pz-plinth">
        <ProfileSelector />
        <div className="pz-enabled">
          <span>Enabled</span>
          <Switch on={l.enabled} toggle={l.toggleEnabled} />
        </div>
        <Menu />
      </div>
    </div>
  )
}

function ProfileSelector() {
  const l = useLucent()
  const custom = l.profile === 'custom'
  return (
    <div className="pz-profile">
      <span className={`pz-profile-label ${custom ? 'is-custom' : ''}`} title={custom ? `You changed ${CUSTOM.changed} in ${CUSTOM.where}.` : undefined}>
        {custom ? `Custom, based on ${profileLabel(l.customBase)}` : 'Performance profile'}
      </span>
      <div className="pz-seg" role="radiogroup" aria-label="Performance profile">
        {PROFILES.map((p) => {
          const on = l.profile === p.key
          const base = custom && l.customBase === p.key
          return (
            <button key={p.key} role="radio" aria-checked={on} className={`${on ? 'is-on' : ''} ${base ? 'is-base' : ''}`} onClick={() => l.setProfile(p.key)}>
              {on && <motion.span layoutId="pz-seg" className="pz-seg-pill" transition={{ type: 'spring', stiffness: 380, damping: 34 }} />}
              <span className="pz-seg-text">{p.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Switch({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label="Enabled" className={`pz-switch ${on ? 'is-on' : ''}`} onClick={toggle}>
      <motion.span className="pz-switch-thumb" layout transition={{ type: 'spring', stiffness: 500, damping: 32 }}>
        <i />
      </motion.span>
    </button>
  )
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('mousedown', onDown)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('mousedown', onDown)
      removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function Menu() {
  const l = useLucent()
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  const act = (item: string) => {
    setOpen(false)
    l.menu(item)
  }
  return (
    <div className="pz-menu-wrap" ref={ref}>
      <button className="pz-icon-btn" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <DotsThreeIcon size={20} weight="bold" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="pz-menu"
            role="menu"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            <button role="menuitem" onClick={() => act('Versions…')}>
              Versions…
            </button>
            <hr />
            <button role="menuitemcheckbox" aria-checked={l.beta} onClick={l.toggleBeta}>
              Beta channel <span className="pz-tick">{l.beta && <CheckIcon size={13} weight="bold" />}</span>
            </button>
            <button role="menuitemcheckbox" aria-checked={l.autoRepair} onClick={l.toggleAutoRepair}>
              XIVLauncher auto-repair <span className="pz-tick">{l.autoRepair && <CheckIcon size={13} weight="bold" />}</span>
            </button>
            <hr />
            {['Copy diagnostics', 'Report a bug', 'Credits'].map((i) => (
              <button key={i} role="menuitem" onClick={() => act(i)}>
                {i}
              </button>
            ))}
            <hr />
            <button role="menuitem" className="is-danger" onClick={() => act('Uninstall…')}>
              Uninstall…
            </button>
            <div className="pz-menu-foot">
              Lucent {APP_VERSION} · content {l.contentVersion}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Changelog() {
  const l = useLucent()
  return (
    <AnimatePresence>
      {l.changelogOpen && (
        <motion.div className="pz-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={l.closeChangelog}>
          <motion.div
            className="pz-sheet"
            role="dialog"
            aria-label={`Content ${CHANGELOG.version}`}
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <span className="pz-eyebrow">Content {CHANGELOG.version}</span>
            <h2 className="pz-h2">What changes</h2>
            <ul className="pz-changes">
              {CHANGELOG.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="pz-sheet-foot">
              <button className="pz-ghost" onClick={l.skip}>
                Skip this version
              </button>
              <button className="pz-primary" onClick={l.update}>
                Update · {CHANGELOG.mb} MB
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Toast() {
  const l = useLucent()
  return (
    <AnimatePresence>
      {l.toast && (
        <motion.div
          key={l.toast.id}
          className="pz-toast"
          role="status"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          {l.toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
