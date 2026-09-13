import { describe, expect, it } from 'vitest'
import { formatDuration } from './text'

describe('formatDuration', () => {
  it('affiche minutes et secondes', () => {
    expect(formatDuration(187_000)).toBe('3:07')
    expect(formatDuration(59_400)).toBe('0:59')
  })

  it('ajoute les heures pour les longues pistes', () => {
    expect(formatDuration(3_750_000)).toBe('1:02:30')
  })

  it('arrondit à la seconde la plus proche', () => {
    expect(formatDuration(59_800)).toBe('1:00')
    expect(formatDuration(0)).toBe('0:00')
  })
})
