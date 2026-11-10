// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MeowPet, { type MeowPetEvent } from '../../src/renderer/src/components/chat/MeowPet'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Props {
  size?: number
  running?: boolean
  phase?: 'thinking' | 'typing'
  event?: MeowPetEvent | null
  className?: string
}

// jsdom has no pointer capture; the pet only uses it so a press that slides off still ends.
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {}
}

let card: HTMLDivElement
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  // Deterministic blink schedule (2200 ms) and heart spread.
  vi.spyOn(Math, 'random').mockReturnValue(0)
  card = document.createElement('div')
  card.className = 'chat-input'
  host = document.createElement('div')
  card.appendChild(host)
  document.body.appendChild(card)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  card.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mount(props: Props): HTMLElement {
  act(() => {
    root.render(createElement(MeowPet, props))
  })
  return host.querySelector('.meow-pet') as HTMLElement
}

const mood = (el: HTMLElement): string | undefined => el.dataset.mood
const face = (el: HTMLElement): string | null =>
  el.querySelector('.meow-pet__face.is-on')?.getAttribute('data-face') ?? null
const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('MeowPet', () => {
  it('draws the logo head at the requested size', () => {
    const pet = mount({ size: 30 })
    expect(pet.style.getPropertyValue('--s')).toBe('30px')
    const head = pet.querySelector('.meow-pet__head path')
    expect(head?.getAttribute('d')).toContain('M8 28')
    expect(pet.getAttribute('aria-hidden')).toBe('true')
  })

  it('rests on idle with the open face', () => {
    const pet = mount({})
    expect(mood(pet)).toBe('idle')
    expect(face(pet)).toBe('open')
  })

  it('tips its head while waiting for the first token, then types', () => {
    const pet = mount({ running: true, phase: 'thinking' })
    expect(mood(pet)).toBe('think')

    act(() => {
      root.render(createElement(MeowPet, { running: true, phase: 'typing' }))
    })
    expect(mood(pet)).toBe('type')

    act(() => {
      root.render(createElement(MeowPet, { running: false }))
    })
    expect(mood(pet)).toBe('idle')
  })

  it('plays a one-shot reaction and falls back to the resting mood', () => {
    const pet = mount({ running: true, phase: 'typing' })
    act(() => {
      root.render(createElement(MeowPet, { running: true, phase: 'typing', event: { kind: 'happy', nonce: 1 } }))
    })
    expect(mood(pet)).toBe('happy')
    expect(face(pet)).toBe('happy')

    advance(1700)
    expect(mood(pet)).toBe('type')

    act(() => {
      root.render(
        createElement(MeowPet, { running: true, phase: 'typing', event: { kind: 'notify', nonce: 2 } })
      )
    })
    expect(mood(pet)).toBe('notify')
    advance(1300)
    expect(mood(pet)).toBe('type')
  })

  it('shows the error face until its own flash ends', () => {
    const pet = mount({ event: { kind: 'error', nonce: 1 } })
    expect(mood(pet)).toBe('error')
    expect(face(pet)).toBe('error')
    advance(2400)
    expect(mood(pet)).toBe('idle')
  })

  it('dozes off after 45 s of no activity and wakes when you type', () => {
    const pet = mount({})
    advance(44_000)
    expect(mood(pet)).toBe('idle')

    advance(1_500)
    expect(mood(pet)).toBe('sleep')
    expect(face(pet)).toBe('sleep')

    act(() => {
      card.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mood(pet)).toBe('idle')
  })

  it('never dozes off mid-turn', () => {
    const pet = mount({ running: true, phase: 'typing' })
    advance(60_000)
    expect(mood(pet)).toBe('type')
  })

  it('squashes when picked up and bursts hearts on a click', () => {
    const pet = mount({})
    const press = (type: string, x: number): void => {
      act(() => {
        pet.dispatchEvent(
          Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10 }), { pointerId: 1 })
        )
      })
    }

    press('pointerdown', 100)
    expect(mood(pet)).toBe('drag')

    press('pointerup', 101)
    expect(mood(pet)).toBe('happy')
    expect(pet.querySelectorAll('.meow-pet__heart')).toHaveLength(3)

    advance(1300)
    expect(pet.querySelectorAll('.meow-pet__heart')).toHaveLength(0)
  })

  it('drops back to the resting mood when the press was a drag, not a click', () => {
    const pet = mount({})
    const press = (type: string, x: number): void => {
      act(() => {
        pet.dispatchEvent(
          Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10 }), { pointerId: 1 })
        )
      })
    }
    press('pointerdown', 100)
    press('pointerup', 160)
    expect(mood(pet)).toBe('idle')
    expect(pet.querySelectorAll('.meow-pet__heart')).toHaveLength(0)
  })
})
