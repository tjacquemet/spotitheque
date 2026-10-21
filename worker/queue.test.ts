import { describe, expect, it } from 'vitest'
import { removedFromQueue } from './queue'

const t = (n: number) => `spotify:track:${n}`

describe('removedFromQueue', () => {
  it('compte les titres disparus', () => {
    expect(removedFromQueue([t(1), t(2), t(3)], [])).toBe(3)
    expect(removedFromQueue([t(1), t(2), t(3)], [t(3)])).toBe(2)
  })

  it('ne voit rien partir quand la file est inchangée', () => {
    expect(removedFromQueue([t(1), t(2)], [t(1), t(2)])).toBe(0)
  })

  /** Le cas du 2026-10-21 : la file retombe à zéro, puis Spotify la regarnit de recommandations. */
  it('voit partir les titres même si Spotify en propose aussitôt d’autres', () => {
    const avant = [t(1), t(2), t(3)]
    const apres = [t(90), t(91), t(92), t(93)]
    expect(removedFromQueue(avant, apres)).toBe(3)
  })

  it('tient compte des répétitions', () => {
    expect(removedFromQueue([t(1), t(1), t(2)], [t(1), t(2)])).toBe(1)
  })

  it('ne compte rien sur une file vide au départ', () => {
    expect(removedFromQueue([], [t(1), t(2)])).toBe(0)
  })
})
