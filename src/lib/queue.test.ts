import { describe, expect, it } from 'vitest'
import { queueMessage } from './queue'

describe('queueMessage', () => {
  it('annonce la lecture et ce qui attend derrière', () => {
    expect(queueMessage(true, 12, 'Salon')).toBe('Lecture lancée sur Salon · 11 titres à la suite')
    expect(queueMessage(true, 2, 'Salon')).toBe('Lecture lancée sur Salon · 1 titre à la suite')
  })

  it('ne promet rien derrière un titre lancé seul', () => {
    expect(queueMessage(true, 1, 'Salon')).toBe('Lecture lancée sur Salon')
  })

  it('compte les titres empilés quand la musique jouait déjà', () => {
    expect(queueMessage(false, 12, 'Salon')).toBe('12 titres ajoutés à la file sur Salon')
  })
})
