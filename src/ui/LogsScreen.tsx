// The Logs section: a terminal that tails Lucent's own log and the logs the deployed tools write in the game folder.
// It reads the files again every second while it is open, so a headless run or the game itself shows up as it writes.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Check, ClipboardCopy } from 'lucide-react'
import { useCore } from './useCore'
import { Screen } from './Window'
import { LUCENT_LOG, logSources, type LogSource } from '../core/log'
import { keyLines, type KeyedLine } from './logKeys'

const REFRESH_MS = 1000
/** How close to the end still counts as following it, in pixels. */
const FOLLOW_SLACK = 24

export function LogsScreen() {
  const [{ deployment }] = useCore()
  const sources = logSources(deployment)
  const [sourceId, setSourceId] = useState(LUCENT_LOG.id)
  const source = sources.find((candidate) => candidate.id === sourceId) ?? sources[0]
  return <Screen title="Logs" sub="What Lucent does, line by line, and what its tools log in game."
    actions={sources.length > 1 && <div className="segmented" role="group" aria-label="Log">
      {sources.map(({ id, label }) => <button key={id} aria-pressed={id === source.id} onClick={() => setSourceId(id)}>{label}</button>)}
    </div>}>
    <Terminal key={source.id} source={source} />
  </Screen>
}

/** Undefined until the first read; null when the log hasn't been written yet. */
function useLogTail(source: LogSource) {
  const [, core] = useCore()
  const [lines, setLines] = useState<KeyedLine[] | null | undefined>(undefined)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let shown: string | undefined
    const refresh = async () => {
      const next = await core.readLog(source)
      if (stopped) return
      // The tail slides once it is full, so its length alone doesn't say whether it changed.
      const last = next?.at(-1)
      const signature = next ? `${next.length} ${last?.date} ${last?.time} ${last?.text}` : ''
      if (signature !== shown) { shown = signature; setLines((previous) => next && keyLines(previous, next)) }
      timer = setTimeout(() => void refresh(), REFRESH_MS)
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
    // A source is identified by its id; the object is rebuilt on every render.
  }, [core, source.id])
  return lines
}

function Terminal({ source }: { source: LogSource }) {
  const [, core] = useCore()
  const lines = useLogTail(source)
  const view = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [copied, setCopied] = useState(false)
  useLayoutEffect(() => {
    if (following && view.current) view.current.scrollTop = view.current.scrollHeight
  }, [lines, following])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  const lucent = source.id === LUCENT_LOG.id
  return <section className="terminal" aria-label={`${source.label} log`}>
    <header className="terminal-bar">
      <span className="terminal-file">{lines?.length ? <span className="live-dot" aria-hidden /> : <span className="terminal-idle" aria-hidden />}{source.file}</span>
      <button className="btn is-ghost terminal-copy" disabled={!lines?.length} onClick={() => void core.copyLog(source).then(setCopied)}>
        {copied ? <Check size={13} strokeWidth={2} /> : <ClipboardCopy size={13} strokeWidth={1.75} />}{copied ? 'Copied' : 'Copy'}
      </button>
    </header>
    {lines === undefined ? <div className="terminal-view" />
      : !lines?.length ? <p className="terminal-empty">{lucent ? 'Nothing logged yet.'
        : `No ${source.file} in your game folder yet. ${source.label} writes it while XIV runs, when its logging is on.`}</p>
      : <div ref={view} className="terminal-view" role="log" aria-label={`${source.label} log`} tabIndex={0}
          onScroll={({ currentTarget: el }) => setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK)}>
          {lines.map((line, index) => {
            const previous = lines[index - 1]
            return <Fragment key={line.id}>
              {line.date && line.date !== previous?.date && <div className="log-day"><span>{line.date}</span></div>}
              <div className={`log-line is-${line.level}${line.time ? '' : ' is-plain'}`}>
                {/* Lines of the same second read as one group under its first timestamp. */}
                {line.time && <time className={line.time === previous?.time && line.date === previous.date ? 'is-repeat' : undefined}>{line.time}</time>}
                <span>{line.text}</span>
              </div>
            </Fragment>
          })}
          <div className="log-prompt" aria-hidden>›<span className="log-caret" /></div>
        </div>}
    {!following && <button className="btn terminal-latest" onClick={() => setFollowing(true)}><ArrowDown size={13} strokeWidth={1.75} />Latest</button>}
  </section>
}
