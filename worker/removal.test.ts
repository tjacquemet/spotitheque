import { describe, expect, it, vi } from 'vitest'
import { confirmRemoval } from './removal'

const answers = (...values: (boolean | null)[]) => {
  const check = vi.fn<() => Promise<boolean | null>>()
  for (const value of values) check.mockResolvedValueOnce(value)
  return check
}

describe('confirmRemoval', () => {
  it("confirme dès que l'album n'est plus sauvegardé", async () => {
    const check = answers(false)
    await expect(confirmRemoval(check, 3, 0)).resolves.toBe('removed')
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('laisse au retrait le temps de se propager', async () => {
    await expect(confirmRemoval(answers(true, true, false), 3, 0)).resolves.toBe('removed')
  })

  it("conclut que l'album est resté si Spotify le voit encore à chaque essai", async () => {
    await expect(confirmRemoval(answers(true, true, true), 3, 0)).resolves.toBe('still-saved')
  })

  it("ne conclut rien quand la vérification elle-même échoue — et n'autorise donc aucune suppression", async () => {
    await expect(confirmRemoval(answers(null, null, null), 3, 0)).resolves.toBe('unknown')
  })

  it("retient qu'il est resté même si un essai a échoué", async () => {
    await expect(confirmRemoval(answers(null, true, null), 3, 0)).resolves.toBe('still-saved')
  })
})
