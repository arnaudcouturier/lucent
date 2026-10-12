// PROTOTYPE Variant D, "Ember": the merge the user asked for after round 1.
// Rail's layout (practical, quiet) + Prism's idea that the crystal's light is the state, with a rebuilt
// 3D crystal. Definitive dark theme: Crunchyroll-style charcoals, #F47521 as the only accent.
// No Mica: the only painted backdrop is the crystal's glow in the rail.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, Cpu, Download, Ellipsis, Folder, Gamepad2, Layers, LoaderCircle, Minus, Power, TriangleAlert, X } from 'lucide-react'
import type { Params } from '../../App'
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
import { Crystal3D, type CrystalMode, type CrystalPalette } from './Crystal3D'
import './ember.css'

const UI = { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const }
const STEP_TITLES = ['Scan', 'Performance profile', 'Review', 'Install', 'Done']

export function Ember({ params }: { params?: Params }) {
  const l = useLucent()
  const s = l.screen
  const first = s !== 'main'
  const resolved = useScanProgress(s === 'scan', 600, 500)
  const installP = useTimedProgress(5600, () => l.go('done'), s === 'install')

  const mode: CrystalMode =
    s === 'scan'
      ? resolved < 4
        ? 'scan'
        : 'glass'
      : s === 'profile' || s === 'review'
        ? 'glass'
        : s === 'install'
          ? 'fill'
          : s === 'done'
            ? 'lit'
            : !l.enabled
              ? 'glass'
              : l.busy
                ? 'busy'
                : l.health === 'drift'
                  ? 'drift'
                  : l.health === 'update'
                    ? 'update'
                    : 'lit'
  const palette: CrystalPalette = params?.crystal ?? 'ember'

  return (
    <div className={`em pal-${palette}`}>
      <aside className="em-rail" data-tauri-drag-region>
        <div className="em-brand" data-tauri-drag-region>
          <Mark />
          Lucent
        </div>
        <div className={`em-stage is-${mode}`}>
          <Crystal3D height={214} mode={mode} palette={palette} fill={installP} />
        </div>
        {first ? <Stepper /> : <Facts />}
        <div className="em-rail-foot">
          Lucent {APP_VERSION}
          {l.beta && <span className="em-chip is-accent">Beta</span>}
        </div>
      </aside>
      <section className="em-pane">
        <div className="em-titlebar" data-tauri-drag-region>
          {!first && <Menu />}
          <button className="em-cap" aria-label="Minimize">
            <Minus size={14} strokeWidth={1.5} />
          </button>
          <button className="em-cap em-cap-close" aria-label="Close">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={s} className="em-screen" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={UI}>
            {s === 'scan' && <ScanView resolved={resolved} />}
            {s === 'profile' && <ProfileView />}
            {s === 'review' && <ReviewView />}
            {s === 'install' && <InstallView p={installP} />}
            {s === 'done' && <DoneView />}
            {s === 'main' && <MainView />}
          </motion.div>
        </AnimatePresence>
        <Toast />
      </section>
    </div>
  )
}

function Mark() {
  return (
    <svg className="em-mark" viewBox="0 0 16 22" aria-hidden>
      <polygon points="8,0 16,8 8,22 0,8" fill="var(--accent)" />
      <path d="M0 8 L6 10 L8 22 M6 10 L16 8" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth=".9" />
    </svg>
  )
}

function Stepper() {
  const l = useLucent()
  const now = FIRST_RUN.indexOf(l.screen)
  return (
    <ol className="em-steps">
      {STEP_TITLES.map((t, i) => (
        <li key={t} className={i < now ? 'is-done' : i === now ? 'is-now' : ''}>
          <span className="em-step-dot">{i < now && <Check size={10} strokeWidth={3} />}</span>
          {t}
        </li>
      ))}
    </ol>
  )
}

function TierBadge({ l }: { l: Lucent }) {
  const st = l.gpu.tierStatus
  if (st === 'Stable') return null
  return <span className={`em-chip ${st === 'Experimental' ? 'is-caution' : ''}`}>{st}</span>
}

function Facts() {
  const l = useLucent()
  return (
    <dl className="em-facts">
      <div>
        <dt>Graphics</dt>
        <dd>
          {l.gpu.short}
          <span className="em-tier">
            {l.gpu.tier} tier <TierBadge l={l} />
          </span>
        </dd>
      </div>
      <div>
        <dt>Content</dt>
        <dd className="em-mono">{l.contentVersion}</dd>
      </div>
      <div>
        <dt>Game</dt>
        <dd>
          <span>
            {GAME.source} · <span className="em-mono">{GAME.version}</span>
          </span>
        </dd>
      </div>
    </dl>
  )
}

function Header({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <header className="em-head">
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </header>
  )
}

function Footer({ back, next, onNext, disabled, icon }: { back?: () => void; next: string; onNext: () => void; disabled?: boolean; icon?: boolean }) {
  return (
    <footer className="em-foot">
      {back && (
        <button className="em-btn" onClick={back}>
          Back
        </button>
      )}
      <button className="em-btn is-primary" onClick={onNext} disabled={disabled}>
        {next}
        {icon && <ArrowRight size={14} strokeWidth={2.25} />}
      </button>
    </footer>
  )
}

/* ---------- First run ---------- */

function ScanView({ resolved }: { resolved: number }) {
  const l = useLucent()
  const ex = l.scenario.existing
  const rows = [
    { icon: Folder, label: 'Game folder', value: <span className="em-mono em-path">{GAME.folder}</span>, meta: `${GAME.source} · ${GAME.version}` },
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
      <ul className="em-card em-list">
        {rows.map((r, i) => {
          const done = i < resolved
          const Icon = r.icon
          return (
            <li key={r.label} className={`em-row ${done ? '' : 'is-pending'} ${done && r.warn ? 'is-warn' : ''}`}>
              <Icon size={15} strokeWidth={1.75} className="em-row-icon" />
              <div className="em-row-main">
                <span className="em-row-label">{r.label}</span>
                <span className="em-row-value">{done ? r.value : <span className="em-skel" />}</span>
                {done && <span className="em-row-meta">{r.meta}</span>}
                {done && r.warn && (
                  <span className="em-files">
                    {EXISTING_SETUP.files.map((f) => (
                      <code key={f}>{f}</code>
                    ))}
                    <span>
                      +{EXISTING_SETUP.fileCount - EXISTING_SETUP.files.length} more · your {EXISTING_SETUP.presetsKept} presets are kept
                    </span>
                  </span>
                )}
              </div>
              <span className="em-row-state">
                {!done && i === resolved && <LoaderCircle size={14} className="em-spin" />}
                {done && !r.warn && <Check size={14} strokeWidth={2.5} />}
                {done && r.warn && <TriangleAlert size={14} strokeWidth={2.25} />}
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
    <span className="em-bars" aria-hidden>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} />
      ))}
    </span>
  )
}

function ProfileRows({ value, onPick, custom, meters }: { value: ProfileKey | 'custom'; onPick: (p: ProfileKey) => void; custom?: boolean; meters?: boolean }) {
  const l = useLucent()
  return (
    <div className="em-card em-radios" role="radiogroup" aria-label="Performance profile">
      {custom && (
        <div className="em-radio is-on is-custom" role="radio" aria-checked>
          <span className="em-radio-dot">
            <motion.span layoutId="em-radio" className="em-radio-fill" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />
          </span>
          <span className="em-radio-text">
            <b>
              Custom <span className="em-muted">· based on {profileLabel(l.customBase)}</span>
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
          <button key={p.key} role="radio" aria-checked={on} className={`em-radio ${on ? 'is-on' : ''}`} onClick={() => onPick(p.key)}>
            <span className="em-radio-dot">
              {on && <motion.span layoutId="em-radio" className="em-radio-fill" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />}
            </span>
            <span className="em-radio-text">
              <b>
                {p.label}
                {meters && p.key === 'balanced' && <span className="em-chip is-accent">Recommended</span>}
              </b>
              <span>{profileText(p, l.gpu)}</span>
            </span>
            {meters && (
              <span className="em-meters">
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
    <label className={`em-check ${locked ? 'is-locked' : ''}`}>
      <input type="checkbox" checked={on} disabled={locked} onChange={(e) => set?.(e.target.checked)} />
      <span className="em-box">{on && <Check size={11} strokeWidth={3.25} />}</span>
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
      <Header
        title="Review"
        sub={`Content ${l.contentVersion} for the ${l.gpu.tier} tier, ${profileLabel(l.profile === 'custom' ? l.customBase : l.profile)} profile.`}
      />
      <dl className="em-card em-kv">
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
          <dd>
            {n.downloadMb}
            <small> MB</small>
          </dd>
        </div>
      </dl>
      {l.scenario.existing && (
        <p className="em-callout">
          <TriangleAlert size={14} strokeWidth={2.25} />
          <span>
            {EXISTING_SETUP.name}: {EXISTING_SETUP.fileCount} files are backed up, then replaced. Your {EXISTING_SETUP.presetsKept} presets are kept.
          </span>
        </p>
      )}
      <div className="em-checks">
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

function InstallView({ p }: { p: number }) {
  const l = useLucent()
  const ph = installPhase(p, l)
  return (
    <>
      <Header title="Install" sub="Keep the game closed until this finishes." />
      <div className="em-progress">
        <div className="em-progress-top">
          <span>{ph.steps[ph.index].label}</span>
          <span className="em-mono">{Math.round(p * 100)}%</span>
        </div>
        <div className="em-bar">
          <span style={{ width: `${p * 100}%` }} />
        </div>
      </div>
      <ul className="em-tasks">
        {ph.steps.map((s, i) => {
          const done = i < ph.index || p >= 1
          return (
            <li key={s.key} className={done ? 'is-done' : i === ph.index ? 'is-now' : ''}>
              <span className="em-task-state">{done ? <Check size={11} strokeWidth={3} /> : i === ph.index ? <LoaderCircle size={13} className="em-spin" /> : null}</span>
              {s.key === 'download' ? 'Download components' : s.label}
              {s.key === 'download' && i === ph.index && (
                <span className="em-task-meta em-mono">
                  {ph.current.name} · {ph.downloadedMb}/{ph.total} MB
                </span>
              )}
              {s.key === 'download' && done && <span className="em-task-meta em-mono">{ph.total} MB</span>}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function DoneView() {
  const l = useLucent()
  return (
    <>
      <Header title="You're set" sub="Start the game as usual. These keys open the in-game overlays." />
      <ul className="em-card em-hotkeys">
        {l.hotkeys.map((h) => (
          <li key={h.key}>
            <kbd>{h.key}</kbd>
            <b>{h.what}</b>
            <span>{h.hint}</span>
          </li>
        ))}
      </ul>
      {l.startMenu && <p className="em-note">Lucent is in your Start menu.</p>}
      <Footer next="Finish" onNext={() => l.go('main')} />
    </>
  )
}

/* ---------- Main ---------- */

function StatusCard() {
  const l = useLucent()
  const pct = Math.round(l.busyProgress * 100)
  let tone = 'ok'
  let icon = <Check size={15} strokeWidth={2.5} />
  let title: ReactNode = 'Healthy'
  let sub: ReactNode = `Game folder matches content ${l.contentVersion}. Checked just now.`
  let action: ReactNode = null
  let body: ReactNode = null

  if (l.busy) {
    tone = 'busy'
    icon = <LoaderCircle size={15} className="em-spin" />
    title = l.busy === 'repair' ? 'Repairing' : `Updating to ${NEXT_CONTENT_VERSION}`
    sub = l.busy === 'repair' ? `Restoring ${DRIFT.files} files` : `${Math.round(l.busyProgress * CHANGELOG.mb)} of ${CHANGELOG.mb} MB`
    action = <span className="em-mono em-muted">{pct}%</span>
  } else if (l.health === 'drift') {
    tone = 'warn'
    icon = <TriangleAlert size={15} strokeWidth={2.25} />
    title = `${DRIFT.files} files need repair`
    sub = `Game patch ${DRIFT.patch} replaced them.`
    action = (
      <button className="em-btn is-primary" onClick={l.repair}>
        Repair
      </button>
    )
  } else if (l.health === 'update') {
    tone = 'update'
    icon = <Download size={15} strokeWidth={2.25} />
    title = `Content ${NEXT_CONTENT_VERSION} is available`
    sub = `${CHANGELOG.changes.length} changes · ${CHANGELOG.mb} MB`
    action = (
      <>
        <button className="em-btn is-ghost" onClick={l.skip}>
          Skip
        </button>
        <button className="em-btn is-primary" onClick={l.update}>
          Update
        </button>
      </>
    )
    body = (
      <ul className="em-changes">
        {CHANGELOG.changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    )
  } else if (!l.enabled) {
    tone = 'off'
    icon = <Power size={15} strokeWidth={2.25} />
    title = 'Disabled'
    sub = 'The game runs without mods. Everything stays in place.'
  }
  if (!l.enabled && l.health !== 'healthy' && !l.busy) sub = <>Disabled. {sub}</>

  return (
    <motion.div layout className={`em-card em-status is-${tone}`} transition={UI}>
      <div className="em-status-row">
        <span className="em-status-icon">{icon}</span>
        <div className="em-status-text">
          <b>{title}</b>
          <span>{sub}</span>
        </div>
        <div className="em-status-actions">{action}</div>
      </div>
      {body}
      {l.busy && (
        <div className="em-bar em-bar-inline">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </motion.div>
  )
}

function MainView() {
  const l = useLucent()
  return (
    <div className="em-main">
      <StatusCard />
      <h2 className="em-section">Performance profile</h2>
      <ProfileRows value={l.profile} onPick={l.setProfile} custom={l.profile === 'custom'} />
      <div className="em-card em-setting">
        <div>
          <b>Enabled</b>
          <span>Turn off to play without mods. Files stay in place.</span>
        </div>
        <button role="switch" aria-checked={l.enabled} aria-label="Enabled" className={`em-switch ${l.enabled ? 'is-on' : ''}`} onClick={l.toggleEnabled}>
          <motion.span layout className="em-switch-thumb" transition={{ type: 'spring', stiffness: 700, damping: 40 }} />
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
    <div className="em-menu-wrap" ref={ref}>
      <button className="em-cap em-more" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={16} strokeWidth={1.75} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="em-menu"
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={UI}
          >
            <button role="menuitem" onClick={() => act('Versions…')}>
              Versions…
            </button>
            <hr />
            <button role="menuitemcheckbox" aria-checked={l.beta} onClick={l.toggleBeta}>
              Beta channel
              <span className={`em-mini-switch ${l.beta ? 'is-on' : ''}`} />
            </button>
            <button role="menuitemcheckbox" aria-checked={l.autoRepair} onClick={l.toggleAutoRepair}>
              XIVLauncher auto-repair
              <span className={`em-mini-switch ${l.autoRepair ? 'is-on' : ''}`} />
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
        <motion.div key={l.toast.id} className="em-toast" role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={UI}>
          <Check size={13} strokeWidth={2.75} />
          {l.toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
