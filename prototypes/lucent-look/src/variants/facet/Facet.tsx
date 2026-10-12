// PROTOTYPE Variant C, "Facet": the crystal lives in the geometry. Every surface is a cut gem (chamfered
// corners, prismatic edges). Asymmetric split: huge kinetic type on the left says the state, a control
// column on the right. Painted aether backdrop (no OS effect). Unbounded + Manrope + Martian Mono.
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
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
import './facet.css'

const EASE = [0.2, 0.8, 0.2, 1] as const

export function Facet() {
  const l = useLucent()
  const first = l.screen !== 'main'
  return (
    <div className="fx">
      <Sky />
      <TitleBar />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={l.screen} className="fx-body" initial="in" animate="on" exit="out">
          {l.screen === 'scan' && <ScanView />}
          {l.screen === 'profile' && <ProfileView />}
          {l.screen === 'review' && <ReviewView />}
          {l.screen === 'install' && <InstallView />}
          {l.screen === 'done' && <DoneView />}
          {l.screen === 'main' && <MainView />}
        </motion.div>
      </AnimatePresence>
      {!first && <Changelog />}
      <Toast />
    </div>
  )
}

/* ---------- Painted backdrop: drifting aether light + an original gem lattice ---------- */
function Sky() {
  const l = useLucent()
  const tone = l.screen === 'main' && l.health === 'drift' && !l.busy ? 'warn' : l.screen === 'main' && !l.enabled ? 'off' : 'on'
  return (
    <div className={`fx-sky is-${tone}`} aria-hidden>
      <span className="fx-blob b1" />
      <span className="fx-blob b2" />
      <span className="fx-blob b3" />
      <svg className="fx-lattice" viewBox="0 0 600 600">
        <defs>
          <linearGradient id="fxsweep" x1="-1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9fe0ff" stopOpacity="0.15" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#9fe0ff" stopOpacity="0.15" />
            <animate attributeName="x1" values="-1;1.2" dur="9s" repeatCount="indefinite" />
            <animate attributeName="x2" values="0;2.2" dur="9s" repeatCount="indefinite" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#fxsweep)" strokeWidth="1">
          <polygon points="300,20 470,140 520,330 420,560 180,560 80,330 130,140" />
          <polygon points="300,120 400,190 420,320 360,450 240,450 180,320 200,190" />
          <path d="M300,20 L300,120 M470,140 L400,190 M520,330 L420,320 M420,560 L360,450 M180,560 L240,450 M80,330 L180,320 M130,140 L200,190" />
          <path d="M300,120 L470,140 M400,190 L520,330 M420,320 L420,560 M360,450 L180,560 M240,450 L80,330 M180,320 L130,140 M200,190 L300,20" />
          <path d="M300,120 L300,450 M200,190 L420,320 M400,190 L180,320" opacity="0.5" />
        </g>
      </svg>
    </div>
  )
}

function Mark() {
  return (
    <svg className="fx-mark" viewBox="0 0 16 22" aria-hidden>
      <polygon points="8,0 16,8 8,22 0,8" fill="none" stroke="#9fdcff" strokeWidth="1.4" />
      <polygon points="8,5 11.5,8.5 8,15 4.5,8.5" fill="#48b0ff" />
    </svg>
  )
}

function TitleBar() {
  const l = useLucent()
  const step = FIRST_RUN.indexOf(l.screen)
  return (
    <div className="fx-title" data-tauri-drag-region>
      <div className="fx-brand">
        <Mark />
        LUCENT
      </div>
      {step >= 0 && (
        <div className="fx-steps" aria-label={`Step ${step + 1} of 5`}>
          {FIRST_RUN.map((k, i) => (
            <i key={k} className={i < step ? 'is-done' : i === step ? 'is-now' : ''} />
          ))}
        </div>
      )}
      <div className="fx-caption">
        {step < 0 && <Menu />}
        <button aria-label="Minimize">
          <MinusIcon size={14} />
        </button>
        <button className="fx-close" aria-label="Close">
          <XIcon size={14} />
        </button>
      </div>
    </div>
  )
}

/* ---------- Primitives ---------- */

function Cut({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`fx-cut ${className}`} {...rest} />
}

function Btn({ primary, children, ...rest }: { primary?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`fx-cut fx-btn ${primary ? 'is-primary' : ''}`} {...rest}>
      {children}
    </button>
  )
}

function Kinetic({ text, className = '' }: { text: string; className?: string }) {
  let n = 0
  return (
    <h1 className={`fx-kinetic ${className}`} aria-label={text.replace('\n', ' ')}>
      {text.split('\n').map((line, li) => (
        <span key={li} className="fx-line" aria-hidden>
          {[...line].map((ch, i) => (
            <motion.span
              key={i}
              className="fx-ch"
              initial={{ y: '0.55em', opacity: 0, filter: 'blur(10px)' }}
              animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
              transition={{ delay: 0.05 + n++ * 0.03, duration: 0.7, ease: EASE }}
            >
              {ch === ' ' ? ' ' : ch}
            </motion.span>
          ))}
        </span>
      ))}
    </h1>
  )
}

const left = {
  in: { opacity: 0, x: -24 },
  on: { opacity: 1, x: 0, transition: { duration: 0.5, ease: EASE } },
  out: { opacity: 0, x: -12, transition: { duration: 0.22 } },
}
const right = {
  in: { opacity: 0, x: 28, clipPath: 'inset(0 0 0 100%)' },
  on: { opacity: 1, x: 0, clipPath: 'inset(0 0 0 0%)', transition: { duration: 0.6, ease: EASE, delay: 0.08 } },
  out: { opacity: 0, x: 12, transition: { duration: 0.22 } },
}

function Split({ eyebrow, title, sub, actions, children, titleClass }: { eyebrow: ReactNode; title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode; titleClass?: string }) {
  return (
    <div className="fx-split">
      <motion.div className="fx-left" variants={left}>
        <span className="fx-eyebrow">{eyebrow}</span>
        <Kinetic key={title} text={title} className={titleClass} />
        {sub && <p className="fx-sub">{sub}</p>}
        {actions && <div className="fx-actions">{actions}</div>}
      </motion.div>
      <motion.div className="fx-right" variants={right}>
        {children}
      </motion.div>
    </div>
  )
}

const stepEyebrow = (l: Lucent) => `STEP 0${FIRST_RUN.indexOf(l.screen) + 1} / 05`

function TierLine({ l }: { l: Lucent }) {
  const st = l.gpu.tierStatus
  return (
    <span className="fx-tier">
      {l.gpu.tier} TIER
      {st !== 'Stable' && <span className={`fx-badge ${st === 'Experimental' ? 'is-exp' : 'is-comm'}`}>{st.toUpperCase()}</span>}
    </span>
  )
}

/* ---------- First run ---------- */

function ScanView() {
  const l = useLucent()
  const resolved = useScanProgress(true, 650, 500)
  const ex = l.scenario.existing
  const tiles = [
    { k: 'GAME FOLDER', v: `${GAME.source} · ${GAME.version}`, d: GAME.folderShort },
    { k: 'GRAPHICS', v: l.gpu.name, d: <TierLine l={l} /> },
    { k: 'LAUNCHER', v: LAUNCHER.name, d: LAUNCHER.note },
    ex
      ? { k: 'EXISTING SETUP', v: EXISTING_SETUP.name, d: `${EXISTING_SETUP.fileCount} files backed up, then replaced · ${EXISTING_SETUP.presetsKept} presets kept`, warn: true }
      : { k: 'EXISTING SETUP', v: 'None', d: 'Nothing to back up' },
  ]
  const done = resolved >= 4
  return (
    <Split
      eyebrow={stepEyebrow(l)}
      title={done ? 'Found' : 'Scan'}
      sub={done ? (ex ? 'Your game, your card, and an old setup that Lucent will back up first.' : 'Your game and your card. Nothing to clean up.') : 'Looking for your game, your graphics card and anything already installed.'}
      actions={
        <Btn primary disabled={!done} onClick={() => l.go('profile')}>
          Continue
        </Btn>
      }
    >
      <div className="fx-stack">
        {tiles.map((t, i) => {
          const st = i < resolved ? (t.warn ? 'warn' : 'ok') : i === resolved ? 'busy' : 'wait'
          return (
            <Cut key={t.k} className={`fx-tile is-${st}`}>
              <span className="fx-tile-k">{t.k}</span>
              <span className="fx-tile-v">{i < resolved ? t.v : '—'}</span>
              <span className="fx-tile-d">{i < resolved ? t.d : ' '}</span>
              <span className="fx-tile-glyph">
                {st === 'ok' && <CheckIcon size={12} weight="bold" />}
                {st === 'warn' && <WarningIcon size={12} weight="bold" />}
              </span>
            </Cut>
          )
        })}
      </div>
    </Split>
  )
}

function Facets({ n }: { n: number }) {
  return (
    <span className="fx-facets" aria-hidden>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} />
      ))}
    </span>
  )
}

function ProfileView() {
  const l = useLucent()
  const sel = l.profile === 'custom' ? CUSTOM.base : l.profile
  return (
    <Split
      eyebrow={stepEyebrow(l)}
      title={'Pick a\nprofile'}
      sub="The only choice during setup. Change it any time."
      actions={
        <>
          <Btn onClick={() => l.go('scan')}>Back</Btn>
          <Btn primary onClick={() => l.go('review')}>
            Continue
          </Btn>
        </>
      }
    >
      <div className="fx-stack" role="radiogroup" aria-label="Performance profile">
        {PROFILES.map((p) => (
          <button key={p.key} role="radio" aria-checked={sel === p.key} className={`fx-cut fx-option ${sel === p.key ? 'is-on' : ''}`} onClick={() => l.setProfile(p.key)}>
            <span className="fx-option-name">
              {p.label}
              {p.key === 'balanced' && <span className="fx-reco">RECOMMENDED</span>}
            </span>
            <span className="fx-option-text">{profileText(p, l.gpu)}</span>
            <span className="fx-option-meters">
              <span>
                IMAGE <Facets n={p.image} />
              </span>
              <span>
                SPEED <Facets n={p.speed} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </Split>
  )
}

function Check({ on, set, label, note, locked }: { on: boolean; set?: (v: boolean) => void; label: string; note?: string; locked?: boolean }) {
  return (
    <label className={`fx-check ${locked ? 'is-locked' : ''}`}>
      <input type="checkbox" checked={on} disabled={locked} onChange={(e) => set?.(e.target.checked)} />
      <span className="fx-box">{on && <CheckIcon size={11} weight="bold" />}</span>
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
    <Split
      eyebrow={stepEyebrow(l)}
      title="Review"
      sub={
        l.scenario.existing ? (
          <span className="fx-warn-text">
            {EXISTING_SETUP.name} are backed up, then replaced. Your {EXISTING_SETUP.presetsKept} presets are kept.
          </span>
        ) : (
          'Nothing is overwritten without a backup. Uninstall puts every file back.'
        )
      }
      actions={
        <>
          <Btn onClick={() => l.go('profile')}>Back</Btn>
          <Btn primary onClick={() => l.go('install')}>
            Install
          </Btn>
        </>
      }
    >
      <Cut className="fx-numbers">
        <div>
          <b>{fmt(n.backedUp)}</b>
          <span>FILES BACKED UP</span>
        </div>
        <div>
          <b>{fmt(n.added)}</b>
          <span>FILES ADDED</span>
        </div>
        <div>
          <b>
            {n.downloadMb}
            <small>MB</small>
          </b>
          <span>DOWNLOAD</span>
        </div>
      </Cut>
      <div className="fx-checks">
        <Check
          on={l.includeReshade}
          set={l.setIncludeReshade}
          label="Include ReShade"
          locked={l.gpu.reshadeRequired}
          note={l.gpu.reshadeRequired ? 'Always included on Radeon' : undefined}
        />
        <Check on={l.startMenu} set={l.setStartMenu} label="Add Lucent to the Start menu" />
      </div>
    </Split>
  )
}

function InstallView() {
  const l = useLucent()
  const p = useTimedProgress(5600, () => l.go('done'))
  const ph = installPhase(p, l)
  return (
    <Split eyebrow={stepEyebrow(l)} title="Install" sub="Keep the game closed until this finishes.">
      <div className="fx-install">
        <span className="fx-pct">
          {Math.round(p * 100)}
          <small>%</small>
        </span>
        <Cut className="fx-band">
          <span style={{ width: `${p * 100}%` }} />
        </Cut>
        <span className="fx-phase">
          {ph.index === 0 ? `${ph.current.name.toUpperCase()} · ${ph.downloadedMb}/${ph.total} MB` : ph.steps[ph.index].label.toUpperCase()}
        </span>
      </div>
    </Split>
  )
}

function DoneView() {
  const l = useLucent()
  return (
    <Split
      eyebrow={stepEyebrow(l)}
      title={"You're\nset"}
      sub={<>Start the game as usual.{l.startMenu && ' Lucent is in your Start menu.'}</>}
      actions={
        <Btn primary onClick={() => l.go('main')}>
          Finish
        </Btn>
      }
    >
      <div className="fx-stack">
        {l.hotkeys.map((h) => (
          <div key={h.key} className="fx-hotkey">
            <Cut className="fx-key">{h.key.toUpperCase()}</Cut>
            <span>
              <b>{h.what}</b>
              <em>{h.hint}</em>
            </span>
          </div>
        ))}
      </div>
    </Split>
  )
}

/* ---------- Main ---------- */

function status(l: Lucent): { word: string; tone: string; sub: ReactNode; action?: ReactNode } {
  if (l.busy === 'repair') return { word: 'Repairing', tone: 'busy', sub: `Restoring ${DRIFT.files} files · ${Math.round(l.busyProgress * 100)}%` }
  if (l.busy === 'update')
    return { word: 'Updating', tone: 'busy', sub: `Content ${NEXT_CONTENT_VERSION} · ${Math.round(l.busyProgress * CHANGELOG.mb)} of ${CHANGELOG.mb} MB` }
  const repair =
    l.health === 'drift' ? (
      <Btn primary onClick={l.repair}>
        Repair
      </Btn>
    ) : undefined
  if (!l.enabled) return { word: 'Disabled', tone: 'off', sub: 'The game runs without mods. Everything stays in place.', action: repair }
  if (l.health === 'drift') return { word: 'Repair\nneeded', tone: 'warn', sub: `Game patch ${DRIFT.patch} replaced ${DRIFT.files} of Lucent's files.`, action: repair }
  if (l.health === 'update')
    return {
      word: 'Update\navailable',
      tone: 'on',
      sub: `Content ${NEXT_CONTENT_VERSION} · ${CHANGELOG.changes.length} changes · ${CHANGELOG.mb} MB`,
      action: (
        <Btn primary onClick={l.openChangelog}>
          Update
        </Btn>
      ),
    }
  return { word: 'Ready', tone: 'on', sub: `Everything matches content ${l.contentVersion}. Checked just now.` }
}

function MainView() {
  const l = useLucent()
  const st = status(l)
  return (
    <div className="fx-split fx-split-main">
      <motion.div className="fx-left" variants={left}>
        <span className="fx-eyebrow">STATUS</span>
        <Kinetic key={st.word} text={st.word} className={`is-${st.tone} ${st.word.includes('\n') ? 'is-two' : ''}`} />
        <p className="fx-sub">{st.sub}</p>
        <div className="fx-actions">{st.action}</div>
        {l.busy && (
          <Cut className="fx-band fx-band-thin">
            <span style={{ width: `${l.busyProgress * 100}%` }} />
          </Cut>
        )}
        <dl className="fx-facts">
          <div>
            <dt>GRAPHICS</dt>
            <dd className="fx-dd-stack">
              <span>{l.gpu.short.toUpperCase()}</span>
              <TierLine l={l} />
            </dd>
          </div>
          <div>
            <dt>CONTENT</dt>
            <dd>{l.contentVersion}</dd>
          </div>
          <div>
            <dt>GAME</dt>
            <dd>{GAME.version}</dd>
          </div>
        </dl>
      </motion.div>
      <motion.div className="fx-right" variants={right}>
        <Cut className="fx-panel">
          <span className={`fx-eyebrow ${l.profile === 'custom' ? 'is-custom' : ''}`}>
            {l.profile === 'custom' ? `CUSTOM · BASED ON ${profileLabel(l.customBase).toUpperCase()}` : 'PERFORMANCE PROFILE'}
          </span>
          <div className="fx-seg" role="radiogroup" aria-label="Performance profile">
            {PROFILES.map((p) => {
              const on = l.profile === p.key
              const base = l.profile === 'custom' && l.customBase === p.key
              return (
                <button key={p.key} role="radio" aria-checked={on} className={`fx-seg-item ${on ? 'is-on' : ''} ${base ? 'is-base' : ''}`} onClick={() => l.setProfile(p.key)}>
                  {on && <motion.span layoutId="fx-seg" className="fx-cut fx-seg-fill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                  <span className="fx-seg-name">{p.label}</span>
                  <Facets n={p.image} />
                </button>
              )
            })}
          </div>
          {l.profile === 'custom' && <p className="fx-panel-note">You changed {CUSTOM.changed} in {CUSTOM.where}. Pick a profile to reset it.</p>}
          <div className="fx-rule" />
          <div className="fx-enabled">
            <span>
              <span className="fx-eyebrow">ENABLED</span>
              <em>{l.enabled ? 'Mods load with the game' : 'The game runs without mods'}</em>
            </span>
            <button role="switch" aria-checked={l.enabled} aria-label="Enabled" className={`fx-cut fx-switch ${l.enabled ? 'is-on' : ''}`} onClick={l.toggleEnabled}>
              <motion.span layout className="fx-cut fx-switch-thumb" transition={{ type: 'spring', stiffness: 600, damping: 36 }} />
            </button>
          </div>
        </Cut>
      </motion.div>
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
    <div className="fx-menu-wrap" ref={ref}>
      <button aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <DotsThreeIcon size={18} weight="bold" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fx-cut fx-menu"
            role="menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <button role="menuitem" onClick={() => act('Versions…')}>
              Versions…
            </button>
            <hr />
            <button role="menuitemcheckbox" aria-checked={l.beta} onClick={l.toggleBeta}>
              Beta channel <i className={`fx-tick ${l.beta ? 'on' : ''}`} />
            </button>
            <button role="menuitemcheckbox" aria-checked={l.autoRepair} onClick={l.toggleAutoRepair}>
              XIVLauncher auto-repair <i className={`fx-tick ${l.autoRepair ? 'on' : ''}`} />
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
            <span className="fx-menu-foot">
              LUCENT {APP_VERSION} · {l.beta ? 'BETA' : 'STABLE'}
            </span>
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
        <motion.div
          className="fx-cut fx-drawer"
          role="dialog"
          aria-label={`Content ${CHANGELOG.version}`}
          initial={{ x: 48, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 30, opacity: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <span className="fx-eyebrow">CONTENT {CHANGELOG.version}</span>
          <h2>What changes</h2>
          <ul>
            {CHANGELOG.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="fx-drawer-foot">
            <Btn onClick={l.skip}>Skip this version</Btn>
            <Btn primary onClick={l.update}>
              Update · {CHANGELOG.mb} MB
            </Btn>
          </div>
          <button className="fx-drawer-close" aria-label="Close" onClick={l.closeChangelog}>
            <XIcon size={14} />
          </button>
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
          className="fx-cut fx-toast"
          role="status"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          {l.toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
