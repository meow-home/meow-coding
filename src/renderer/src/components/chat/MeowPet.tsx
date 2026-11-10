import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

/** One-shot reaction the chat panel asks the pet to play. */
export interface MeowPetEvent {
  kind: 'happy' | 'error' | 'notify'
  /** Bumped on every request, so two identical reactions still replay. */
  nonce: number
}

interface Props {
  /** Rendered box in px. The SVG scales with it, so the pet stays sharp at any size. */
  size?: number
  /** A turn is in flight — the pet leans in and types. */
  running?: boolean
  /** Which half of the turn: waiting for the first token, or streaming it. */
  phase?: 'thinking' | 'typing'
  /** Turn finished (`happy`) or failed (`error`). */
  event?: MeowPetEvent | null
  /** Extra class on the root, used by the composer to place it on the card's border. */
  className?: string
}

type Mood = 'idle' | 'look' | 'think' | 'type' | 'sleep' | 'happy' | 'error' | 'notify' | 'drag'

// Logo path verbatim (meow-coding-logo.svg, 64-grid), so the mascot never drifts from the icon.
const HEAD =
  'M8 28 Q8 20 16 20 L19 10.5 Q20 9 21.2 10.5 L27 20 H37 L42.8 10.5 Q44 9 45 10.5 L48 20 Q56 20 56 28 V48 Q56 56 48 56 H16 Q8 56 8 48 Z'
const BLUE = '#3b8bf5'
const ORANGE = '#f7941d'

const BLINK_MS = 130
const HAPPY_MS = 1700
const ERROR_MS = 2400
const NOTIFY_MS = 1300
// Long enough that it only dozes off when you have genuinely walked away, short enough
// that a pause in a conversation still shows some life.
const SLEEP_AFTER_MS = 45000

/**
 * Composer mascot: the logo's cat head with two round eyes, perched on the top border of
 * the chat input card. Pure decoration — it never takes focus and never blocks the field.
 */
const MeowPet = memo(function MeowPet({
  size = 36,
  running = false,
  phase,
  event = null,
  className
}: Props) {
  const gid = 'mpg-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  // Waiting for the first token and streaming it look different: the pet tips its head at
  // three dots, then leans in and types.
  const resting: Mood = !running ? 'idle' : phase === 'thinking' ? 'think' : 'type'
  const [mood, setMood] = useState<Mood>(resting)
  const [blink, setBlink] = useState(false)
  const [hearts, setHearts] = useState<{ id: number; dx: number }[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const heartSeq = useRef(0)
  const revertRef = useRef<number | null>(null)
  const sleepRef = useRef<number | null>(null)
  const pressRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const restingRef = useRef<Mood>(resting)
  restingRef.current = resting

  const flash = useCallback((next: Mood, ms: number) => {
    setMood(next)
    if (revertRef.current !== null) window.clearTimeout(revertRef.current)
    revertRef.current = window.setTimeout(() => {
      revertRef.current = null
      setMood(restingRef.current)
    }, ms)
  }, [])

  // Every interaction pushes the doze-off timer out, and wakes a sleeping pet.
  const wake = useCallback(() => {
    if (sleepRef.current !== null) window.clearTimeout(sleepRef.current)
    setMood(m => (m === 'sleep' ? restingRef.current : m))
    sleepRef.current = window.setTimeout(() => {
      sleepRef.current = null
      if (restingRef.current === 'idle') setMood(prev => (prev === 'idle' ? 'sleep' : prev))
    }, SLEEP_AFTER_MS)
  }, [])

  // Turn state owns the resting mood; a flash or a doze-off in flight is cut short by it.
  useEffect(() => {
    if (revertRef.current !== null) {
      window.clearTimeout(revertRef.current)
      revertRef.current = null
    }
    setMood(restingRef.current)
    wake()
  }, [running, phase, wake])

  useEffect(() => {
    if (!event) return
    const ms = event.kind === 'error' ? ERROR_MS : event.kind === 'notify' ? NOTIFY_MS : HAPPY_MS
    flash(event.kind, ms)
  }, [event, flash])

  useEffect(() => {
    return () => {
      if (revertRef.current !== null) window.clearTimeout(revertRef.current)
      if (sleepRef.current !== null) window.clearTimeout(sleepRef.current)
    }
  }, [])

  // Typing is activity too — the field is uncontrolled, so the pet listens to the card
  // instead of taking the value as a prop.
  useEffect(() => {
    const card = rootRef.current?.closest('.chat-input')
    if (!card) return
    const onInput = () => wake()
    card.addEventListener('input', onInput)
    return () => card.removeEventListener('input', onInput)
  }, [wake])

  // Blink: one 130 ms squash every 2.2–6 s, never while the pet is mid-reaction.
  useEffect(() => {
    let alive = true
    let timer = 0
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!alive) return
        setBlink(true)
        timer = window.setTimeout(() => {
          if (!alive) return
          setBlink(false)
          schedule()
        }, BLINK_MS)
      }, 2200 + Math.random() * 3800)
    }
    schedule()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  const burst = useCallback(() => {
    const batch = [0, 1, 2].map(i => ({ id: ++heartSeq.current, dx: (i - 1) * 7 }))
    setHearts(prev => [...prev, ...batch])
    window.setTimeout(() => {
      const ids = batch.map(h => h.id)
      setHearts(prev => prev.filter(h => !ids.includes(h.id)))
    }, 1300)
  }, [])

  const face = mood === 'happy' || mood === 'error' || mood === 'sleep' ? mood : 'open'

  // Pointer down squashes the pet as if picked up; letting go without moving is a click.
  const pickUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pressRef.current = { x: e.clientX, y: e.clientY, t: performance.now() }
    wake()
    setMood('drag')
  }

  const drop = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    pressRef.current = null
    const isClick =
      press !== null &&
      Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6 &&
      performance.now() - press.t < 500
    if (isClick) {
      burst()
      flash('happy', HAPPY_MS)
    } else {
      setMood(restingRef.current)
    }
  }

  return (
    <div
      ref={rootRef}
      className={'meow-pet' + (className ? ' ' + className : '')}
      data-mood={mood}
      data-blink={blink ? '1' : undefined}
      style={{ '--s': size + 'px' } as CSSProperties}
      title="Meow"
      aria-hidden="true"
      onPointerEnter={() => {
        wake()
        // Waking up goes straight to looking around; a resting pet just glances over.
        setMood(m => (m === 'sleep' ? 'look' : m === 'idle' ? 'look' : m))
      }}
      onPointerLeave={() => {
        setMood(m => (m === 'look' ? restingRef.current : m))
      }}
      onPointerDown={pickUp}
      onPointerUp={drop}
      onPointerCancel={() => {
        pressRef.current = null
        setMood(restingRef.current)
      }}
    >
      <div className="meow-pet__shadow" />
      <div className="meow-pet__body">
        <svg className="meow-pet__svg" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a424c" />
              <stop offset="0.55" stopColor="#262c34" />
              <stop offset="1" stopColor="#181c21" />
            </linearGradient>
          </defs>
          <g>
            <rect className="meow-pet__foot" x="30" y="75" width="13" height="13" rx="6.5" />
            <rect className="meow-pet__foot" x="53" y="75" width="13" height="13" rx="6.5" />
          </g>
          <g transform="translate(3.2 4) scale(1.4)">
            <g className="meow-pet__head">
              <path d={HEAD} fill={`url(#${gid})`} />
              <path d={HEAD} fill="none" stroke="rgba(255,255,255,.11)" strokeWidth="1.1" />
              <path className="meow-pet__ear" d="M18.6 19.7 L19.9 13.3 L22.5 19.7 Z" fill={BLUE} opacity=".3" />
              <path className="meow-pet__ear" d="M45.4 19.7 L44.1 13.3 L41.5 19.7 Z" fill={ORANGE} opacity=".3" />

              <g className={'meow-pet__face' + (face === 'open' ? ' is-on' : '')} data-face="open">
                <g className="meow-pet__eye">
                  <ellipse cx="25.5" cy="35.5" rx="4.7" ry="5.3" fill={BLUE} />
                  <circle cx="23.7" cy="33.3" r="1.4" fill="#fff" opacity=".82" />
                </g>
                <g className="meow-pet__eye">
                  <ellipse cx="38.5" cy="35.5" rx="4.7" ry="5.3" fill={BLUE} />
                  <circle cx="36.7" cy="33.3" r="1.4" fill="#fff" opacity=".82" />
                </g>
                <path
                  d="M28.5 45 Q32 48.4 35.5 45"
                  fill="none"
                  stroke={ORANGE}
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
              </g>

              <g className={'meow-pet__face' + (face === 'happy' ? ' is-on' : '')} data-face="happy">
                <path
                  d="M20.5 38 Q25.5 31.6 30.5 38"
                  fill="none"
                  stroke={BLUE}
                  strokeWidth="3.6"
                  strokeLinecap="round"
                />
                <path
                  d="M33.5 38 Q38.5 31.6 43.5 38"
                  fill="none"
                  stroke={BLUE}
                  strokeWidth="3.6"
                  strokeLinecap="round"
                />
                <path
                  d="M28 44.4 Q32 49.2 36 44.4"
                  fill="none"
                  stroke={ORANGE}
                  strokeWidth="3.6"
                  strokeLinecap="round"
                />
              </g>

              <g className={'meow-pet__face' + (face === 'sleep' ? ' is-on' : '')} data-face="sleep">
                <path
                  d="M21 36.6 Q25.5 40 30 36.6"
                  fill="none"
                  stroke={BLUE}
                  strokeWidth="3.4"
                  strokeLinecap="round"
                />
                <path
                  d="M34 36.6 Q38.5 40 43 36.6"
                  fill="none"
                  stroke={BLUE}
                  strokeWidth="3.4"
                  strokeLinecap="round"
                />
                <path
                  d="M29 45.4 H35"
                  fill="none"
                  stroke={ORANGE}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </g>

              <g className={'meow-pet__face' + (face === 'error' ? ' is-on' : '')} data-face="error">
                <path
                  d="M21.4 32.4 L28.6 39.6 M28.6 32.4 L21.4 39.6"
                  fill="none"
                  stroke={BLUE}
                  strokeWidth="3.4"
                  strokeLinecap="round"
                />
                <path
                  d="M35.4 32.4 L42.6 39.6 M42.6 32.4 L35.4 39.6"
                  fill="none"
                  stroke={BLUE}
                  strokeWidth="3.4"
                  strokeLinecap="round"
                />
                <path
                  d="M29 45.4 H35"
                  fill="none"
                  stroke={ORANGE}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </g>
            </g>
          </g>
        </svg>
      </div>
      <div className="meow-pet__fx">
        <div className="meow-pet__glow" />
        <div className="meow-pet__think">
          <i />
          <i />
          <i />
        </div>
        <div className="meow-pet__zzz">
          <i>z</i>
          <i>z</i>
          <i>z</i>
        </div>
        <div className="meow-pet__spark">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        {hearts.map(h => (
          <i
            key={h.id}
            className="meow-pet__heart"
            style={{ '--dx': h.dx + 'px' } as CSSProperties}
          >
            ♥
          </i>
        ))}
      </div>
    </div>
  )
})

export default MeowPet
