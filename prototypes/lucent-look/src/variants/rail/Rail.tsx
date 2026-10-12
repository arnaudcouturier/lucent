// PROTOTYPE Variant B, "Rail": a calm instrument panel. Left rail holds context (setup steps, then the
// deployment's facts), the right pane holds controls as rows. Opaque window (same on Win10 and Win11),
// crisp 150ms motion, Geist + Geist Mono, Lucide icons. Crystal motif reduced to the logo mark.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  Check,
  Cpu,
  Download,
  Ellipsis,
  Folder,
  Gamepad2,
  Layers,
  LoaderCircle,
  Minus,
  Power,
  TriangleAlert,
  X,
} from 'lucide-react'
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
  type ProfileKey,
} from '../../lucent/data'
import './rail.css'

const FAST = { duration: 0.16, ease: [0.2, 0, 0, 1] as const }
const STEP_TITLES = ['Scan', 'Performance profile', 'Review', 'Install', 'Done']

export function Rail() {
  const l = useLucent()
  const first = l.screen !== 'main'
  return (
    <div className="rl">
      <aside className="rl-rail" data-tauri-drag-region>
        <div className="rl-brand" data-tauri-drag-region>
          <Mark />
          Lucent
        </div>
        {first ? <Stepper /> : <Facts />}
        <div className="rl-rail-foot">
          Lucent {APP_VERSION}
          {l.beta && <span className="rl-pill">Beta</span>}
        </div>
      </aside>
      <section className="rl-pane">
        <div className="rl-titlebar" data-tauri-drag-region>
          {!first && <Menu />}
          <button className="rl-cap" aria-label="Minimize">
            <Minus size={14} strokeWidth={1.5} />
          </button>
          <button className="rl-cap rl-cap-close" aria-label="Close">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={l.screen}
            className="rl-screen"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={FAST}
          >
            {l.screen === 'scan' && <ScanView />}
            {l.screen === 'profile' && <ProfileView />}
            {l.screen === 'review' && <ReviewView />}
            {l.screen === 'install' && <InstallView />}
            {l.screen === 'done' && <DoneView />}
            {l.screen === 'main' && <MainView />}
          </motion.div>
        </AnimatePresence>
        <Toast />
      </section>
    </div>
  )
}

function Mark() {
  return (
    <svg className="rl-mark" viewBox="0 0 16 22" aria-hidden>
      <defs>
        <linearGradient id="rlmark" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#a9dcff" />
          <stop offset="1" stopColor="#3d7bff" />
        </linearGradient>
      </defs>
      <polygon points="8,0 16,8 8,22 0,8" fill="url(#rlmark)" />
      <path d="M0 8 L6 10 L8 22 M6 10 L16 8" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth=".8" />
    </svg>
  )
}

function Stepper() {
  const l = useLucent()
  const now = FIRST_RUN.indexOf(l.screen)
  return (
    <ol className="rl-steps">
      {STEP_TITLES.map((t, i) => (
        <li key={t} className={i < now ? 'is-done' : i === now ? 'is-now' : ''}>
          <span className="rl-step-dot">{i < now ? <Check size={11} strokeWidth={2.5} /> : null}</span>
          {t}
        </li>
      ))}
    </ol>
  )
}

function TierBadge({ l }: { l: Lucent }) {
  const st = l.gpu.tierStatus
  if (st === 'Stable') return null
  return <span className={`rl-badge ${st === 'Experimental' ? 'is-exp' : 'is-comm'}`}>{st}</span>
}

function Facts() {
  const l = useLucent()
  return (
    <dl className="rl-facts">
      <div>
        <dt>Game</dt>
        <dd>
          <span>
            {GAME.source} · <span className="rl-mono">{GAME.version}</span>
          </span>
        </dd>
      </div>
      <div>
        <dt>Graphics</dt>
        <dd>
          {l.gpu.short}
          <span className="rl-tier">
            {l.gpu.tier} tier <TierBadge l={l} />
          </span>
        </dd>
      </div>
      <div>
        <dt>Content</dt>
        <dd className="rl-mono">{l.contentVersion}</dd>
      </div>
    </dl>
  )
}

function Header({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <header className="rl-head">
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </header>
  )
}

function Footer({ back, next, onNext, disabled, icon }: { back?: () => void; next: string; onNext: () => void; disabled?: boolean; icon?: boolean }) {
  return (
    <footer className="rl-foot">
      {back && (
        <button className="rl-btn" onClick={back}>
          Back
        </button>
      )}
      <button className="rl-btn rl-btn-primary" onClick={onNext} disabled={disabled}>
        {next}
        {icon && <ArrowRight size={14} strokeWidth={2} />}
      </button>
    </footer>
  )
}

/* ---------- First run ---------- */

function ScanView() {
  const l = useLucent()
  const resolved = useScanProgress(true, 600, 400)
  const ex = l.scenario.existing
  const rows = [
    { icon: Folder, label: 'Game folder', value: <span className="rl-mono rl-path">{GAME.folder}</span>, meta: `${GAME.source} · ${GAME.version}` },
    {
      icon: Cpu,
      label: 'Graphics card',
      value: l.gpu.name,
      meta: (
        <>
          {l.gpu.tier} tier <TierBadge l={l} />
        </>
      ),
    },
    { icon: Gamepad2, label: 'Launcher', value: LAUNCHER.name, meta: LAUNCHER.note },
    {
      icon: Layers,
      label: 'Existing setup',
      value: ex ? EXISTING_SETUP.name : 'None found',
      meta: ex ? `${EXISTING_SETUP.fileCount} files · backed up, then replaced` : 'Nothing to back up',
      warn: ex,
    },
  ]
  return (
    <>
      <Header title="Scan" sub="Lucent looks for your game, your graphics card and anything already installed." />
      <ul className="rl-list">
        {rows.map((r, i) => {
          const done = i < resolved
          const Icon = r.icon
          return (
            <li key={r.label} className={`rl-row ${done ? '' : 'is-pending'} ${done && r.warn ? 'is-warn' : ''}`}>
              <Icon size={16} strokeWidth={1.75} className="rl-row-icon" />
              <div className="rl-row-main">
                <span className="rl-row-label">{r.label}</span>
                <span className="rl-row-value">{done ? r.value : <span className="rl-skel" />}</span>
                {done && <span className="rl-row-meta">{r.meta}</span>}
                {done && r.warn && (
                  <span className="rl-files">
                    {EXISTING_SETUP.files.map((f) => (
                      <code key={f}>{f}</code>
                    ))}
                    <span>+{EXISTING_SETUP.fileCount - EXISTING_SETUP.files.length} more · your {EXISTING_SETUP.presetsKept} presets are kept</span>
                  </span>
                )}
              </div>
              <span className="rl-row-state">
                {!done && i === resolved && <LoaderCircle size={15} className="rl-spin" />}
                {done && !r.warn && <Check size={15} strokeWidth={2.25} />}
                {done && r.warn && <TriangleAlert size={15} strokeWidth={2} />}
              </span>
            </li>
          )
        })}
      </ul>
      <Footer next="Continue" icon disabled={resolved < 4} onNext={() => l.go('profile')} />
    </>
  )
}

function Bars({ n }: { n: number }) {
  return (
    <span className="rl-bars" aria-hidden>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} />
      ))}
    </span>
  )
}

function ProfileRows({ value, onPick, custom, meters }: { value: ProfileKey | 'custom'; onPick: (p: ProfileKey) => void; custom?: boolean; meters?: boolean }) {
  const l = useLucent()
  return (
    <div className="rl-radios" role="radiogroup" aria-label="Performance profile">
      {custom && (
        <div className="rl-radio is-on is-custom" role="radio" aria-checked>
          <span className="rl-radio-dot">
            <motion.span layoutId="rl-radio" className="rl-radio-fill" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />
          </span>
          <span className="rl-radio-text">
            <b>
              Custom <span className="rl-muted">· based on {profileLabel(l.customBase)}</span>
            </b>
            <span>
              You changed {CUSTOM.changed} in {CUSTOM.where}. Pick a profile to go back to it.
            </span>
          </span>
        </div>
      )}
      {PROFILES.map((p) => {
        const on = value === p.key
        return (
          <button key={p.key} role="radio" aria-checked={on} className={`rl-radio ${on ? 'is-on' : ''}`} onClick={() => onPick(p.key)}>
            <span className="rl-radio-dot">
              {on && <motion.span layoutId="rl-radio" className="rl-radio-fill" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />}
            </span>
            <span className="rl-radio-text">
              <b>
                {p.label}
                {meters && p.key === 'balanced' && <span className="rl-pill">Recommended</span>}
              </b>
              <span>{profileText(p, l.gpu)}</span>
            </span>
            {meters && (
              <span className="rl-meters">
                <span>
                  Image <Bars n={p.image} />
                </span>
                <span>
                  Speed <Bars n={p.speed} />
                </span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function ProfileView() {
  const l = useLucent()
  return (
    <>
      <Header title="Performance profile" sub="Your only choice during setup. You can change it any time." />
      <ProfileRows value={l.profile === 'custom' ? l.customBase : l.profile} onPick={l.setProfile} meters />
      <Footer back={() => l.go('scan')} next="Continue" icon onNext={() => l.go('review')} />
    </>
  )
}

function Toggle({ on, set, label, note, locked }: { on: boolean; set?: (v: boolean) => void; label: string; note?: string; locked?: boolean }) {
  return (
    <label className={`rl-check ${locked ? 'is-locked' : ''}`}>
      <input type="checkbox" checked={on} disabled={locked} onChange={(e) => set?.(e.target.checked)} />
      <span className="rl-box">{on && <Check size={12} strokeWidth={3} />}</span>
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
    <>
      <Header title="Review" sub={`Content ${l.contentVersion} for the ${l.gpu.tier} tier, ${profileLabel(l.profile === 'custom' ? l.customBase : l.profile)} profile.`} />
      <dl className="rl-kv">
        <div>
          <dt>Files backed up</dt>
          <dd>{fmt(n.backedUp)}</dd>
        </div>
        <div>
          <dt>Files added</dt>
          <dd>{fmt(n.added)}</dd>
        </div>
        <div>
          <dt>Download</dt>
          <dd>{n.downloadMb} MB</dd>
        </div>
      </dl>
      {l.scenario.existing && (
        <p className="rl-callout">
          <TriangleAlert size={14} strokeWidth={2} />
          <span>
            {EXISTING_SETUP.name}: {EXISTING_SETUP.fileCount} files are backed up, then replaced. Your {EXISTING_SETUP.presetsKept} presets are kept.
          </span>
        </p>
      )}
      <div className="rl-checks">
        <Toggle
          on={l.includeReshade}
          set={l.setIncludeReshade}
          label="Include ReShade"
          locked={l.gpu.reshadeRequired}
          note={l.gpu.reshadeRequired ? 'Always included on Radeon' : 'Shaders and presets, opened with Home in game'}
        />
        <Toggle on={l.startMenu} set={l.setStartMenu} label="Add Lucent to the Start menu" note="Installs Lucent for your account. No admin rights." />
      </div>
      <Footer back={() => l.go('profile')} next="Install" onNext={() => l.go('install')} />
    </>
  )
}

function InstallView() {
  const l = useLucent()
  const p = useTimedProgress(5200, () => l.go('done'))
  const ph = installPhase(p, l)
  return (
    <>
      <Header title="Install" sub="Keep the game closed until this finishes." />
      <div className="rl-progress">
        <div className="rl-progress-top">
          <span>{ph.steps[ph.index].label}</span>
          <span className="rl-mono">{Math.round(p * 100)}%</span>
        </div>
        <div className="rl-bar">
          <span style={{ width: `${p * 100}%` }} />
        </div>
      </div>
      <ul className="rl-tasks">
        {ph.steps.map((s, i) => (
          <li key={s.key} className={i < ph.index || p >= 1 ? 'is-done' : i === ph.index ? 'is-now' : ''}>
            <span className="rl-task-state">
              {i < ph.index || p >= 1 ? <Check size={13} strokeWidth={2.5} /> : i === ph.index ? <LoaderCircle size={13} className="rl-spin" /> : null}
            </span>
            {s.key === 'download' ? 'Download components' : s.label}
            {s.key === 'download' && i === ph.index && (
              <span className="rl-task-meta rl-mono">
                {ph.current.name} · {ph.downloadedMb}/{ph.total} MB
              </span>
            )}
            {s.key === 'download' && i < ph.index && <span className="rl-task-meta rl-mono">{ph.total} MB</span>}
          </li>
        ))}
      </ul>
    </>
  )
}

function DoneView() {
  const l = useLucent()
  return (
    <>
      <Header title="Done" sub="Start the game as usual. These keys open the in-game overlays." />
      <ul className="rl-hotkeys">
        {l.hotkeys.map((h) => (
          <li key={h.key}>
            <kbd>{h.key}</kbd>
            <b>{h.what}</b>
            <span>{h.hint}</span>
          </li>
        ))}
      </ul>
      {l.startMenu && <p className="rl-note">Lucent is in your Start menu.</p>}
      <Footer next="Finish" onNext={() => l.go('main')} />
    </>
  )
}

/* ---------- Main ---------- */

function StatusCard() {
  const l = useLucent()
  const pct = Math.round(l.busyProgress * 100)
  let tone = 'ok'
  let icon = <Check size={16} strokeWidth={2.25} />
  let title: ReactNode = 'Healthy'
  let sub: ReactNode = `Game folder matches content ${l.contentVersion}. Checked just now.`
  let action: ReactNode = null
  let body: ReactNode = null

  if (l.busy) {
    tone = 'busy'
    icon = <LoaderCircle size={16} className="rl-spin" />
    title = l.busy === 'repair' ? 'Repairing' : `Updating to ${NEXT_CONTENT_VERSION}`
    sub = l.busy === 'repair' ? `Restoring ${DRIFT.files} files` : `${Math.round(l.busyProgress * CHANGELOG.mb)} of ${CHANGELOG.mb} MB`
    action = <span className="rl-mono rl-muted">{pct}%</span>
  } else if (l.health === 'drift') {
    tone = 'warn'
    icon = <TriangleAlert size={16} strokeWidth={2} />
    title = `${DRIFT.files} files need repair`
    sub = `Game patch ${DRIFT.patch} replaced them.`
    action = (
      <button className="rl-btn rl-btn-primary" onClick={l.repair}>
        Repair
      </button>
    )
  } else if (l.health === 'update') {
    tone = 'update'
    icon = <Download size={16} strokeWidth={2} />
    title = `Content ${NEXT_CONTENT_VERSION} is available`
    sub = `${CHANGELOG.changes.length} changes · ${CHANGELOG.mb} MB`
    action = (
      <>
        <button className="rl-btn" onClick={l.skip}>
          Skip
        </button>
        <button className="rl-btn rl-btn-primary" onClick={l.update}>
          Update
        </button>
      </>
    )
    body = (
      <ul className="rl-changes">
        {CHANGELOG.changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    )
  } else if (!l.enabled) {
    tone = 'off'
    icon = <Power size={16} strokeWidth={2} />
    title = 'Disabled'
    sub = 'The game runs without mods. Everything stays in place.'
  }
  if (!l.enabled && l.health !== 'healthy' && !l.busy) sub = <>Disabled. {sub}</>

  return (
    <motion.div layout className={`rl-status is-${tone}`} transition={FAST}>
      <div className="rl-status-row">
        <span className="rl-status-icon">{icon}</span>
        <div className="rl-status-text">
          <b>{title}</b>
          <span>{sub}</span>
        </div>
        <div className="rl-status-actions">{action}</div>
      </div>
      {body}
      {l.busy && (
        <div className="rl-bar rl-bar-inline">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </motion.div>
  )
}

function MainView() {
  const l = useLucent()
  return (
    <div className="rl-main">
      <StatusCard />
      <h2 className="rl-section">Performance profile</h2>
      <ProfileRows value={l.profile} onPick={l.setProfile} custom={l.profile === 'custom'} />
      <div className="rl-setting">
        <div>
          <b>Enabled</b>
          <span>Turn off to play without mods. Files stay in place.</span>
        </div>
        <button role="switch" aria-checked={l.enabled} aria-label="Enabled" className={`rl-switch ${l.enabled ? 'is-on' : ''}`} onClick={l.toggleEnabled}>
          <motion.span layout className="rl-switch-thumb" transition={{ type: 'spring', stiffness: 700, damping: 40 }} />
        </button>
      </div>
    </div>
  )
}

function Menu() {
  const l = useLucent()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('mousedown', onDown)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('mousedown', onDown)
      removeEventListener('keydown', onKey)
    }
  }, [open])
  const act = (i: string) => {
    setOpen(false)
    l.menu(i)
  }
  return (
    <div className="rl-menu-wrap" ref={ref}>
      <button className="rl-cap rl-more" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={16} strokeWidth={1.75} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="rl-menu" role="menu" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={FAST}>
            <button role="menuitem" onClick={() => act('Versions…')}>
              Versions…
            </button>
            <hr />
            <button role="menuitemcheckbox" aria-checked={l.beta} onClick={l.toggleBeta}>
              Beta channel
              <span className={`rl-mini-switch ${l.beta ? 'is-on' : ''}`} />
            </button>
            <button role="menuitemcheckbox" aria-checked={l.autoRepair} onClick={l.toggleAutoRepair}>
              XIVLauncher auto-repair
              <span className={`rl-mini-switch ${l.autoRepair ? 'is-on' : ''}`} />
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Toast() {
  const l = useLucent()
  return (
    <AnimatePresence>
      {l.toast && (
        <motion.div key={l.toast.id} className="rl-toast" role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={FAST}>
          <Check size={14} strokeWidth={2.5} />
          {l.toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
