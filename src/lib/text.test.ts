import { describe, expect, it } from 'vitest'
import { formatDuration, formatTotalDuration } from './text'

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

describe('formatTotalDuration', () => {
  it('donne des minutes pour un album court', () => {
    expect(formatTotalDuration(47 * 60_000)).toBe('47 min')
    expect(formatTotalDuration(59 * 60_000)).toBe('59 min')
  })

  it("bascule en heures dès que l'arrondi atteint soixante minutes", () => {
    expect(formatTotalDuration(59 * 60_000 + 40_000)).toBe('1 h 00')
  })

  it('passe aux heures au-delà de soixante minutes', () => {
    expect(formatTotalDuration(72 * 60_000)).toBe('1 h 12')
    expect(formatTotalDuration(125 * 60_000)).toBe('2 h 05')
  })
})
