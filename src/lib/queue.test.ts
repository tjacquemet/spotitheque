import { describe, expect, it } from 'vitest'
import { clearMessage, queueMessage } from './queue'

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

describe('clearMessage', () => {
  it('compte les titres sortis, pas ceux qui restent', () => {
    // 20 titres annoncés après coup : la lecture automatique a pris la place, le vidage a bien eu lieu.
    expect(clearMessage({ status: 'cleared', removed: 11, remaining: 20 })).toEqual({
      text: 'File vidée · 11 titres retirés',
      ok: true,
    })
  })

  it('ne dit rien quand il n’y avait rien', () => {
    expect(clearMessage({ status: 'cleared', removed: 0, remaining: 0 }).text).toBe('La file était déjà vide.')
  })

  it("n'accuse pas Spotify quand il n'y avait rien à retirer", () => {
    expect(clearMessage({ status: 'nothing_removed', remaining: 20 })).toEqual({
      text: "Rien n'est sorti de la file : ces 20 titres annoncés sont sans doute la lecture automatique de Spotify.",
      ok: false,
    })
  })

  it('distingue « rien ne joue » d’une file vide', () => {
    expect(clearMessage({ status: 'nothing_playing' })).toEqual({
      text: "Rien ne joue : il n'y a pas de file à vider.",
      ok: false,
    })
  })
})
