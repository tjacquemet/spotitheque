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
  it('compte ce que la relecture dit avoir disparu', () => {
    expect(clearMessage({ status: 'cleared', before: 11, after: 0 })).toEqual({
      text: 'File vidée · 11 titres retirés',
      ok: true,
    })
  })

  it('ne dit rien quand il n’y avait rien', () => {
    expect(clearMessage({ status: 'cleared', before: 0, after: 0 }).text).toBe('La file était déjà vide.')
  })

  it("avoue l'échec plutôt que d'annoncer une file vide", () => {
    expect(clearMessage({ status: 'unchanged', before: 11, after: 11 })).toEqual({
      text: "Spotify n'a pas vidé la file (11 titres toujours en attente).",
      ok: false,
    })
  })

  it('reste sobre quand Spotify ne donne pas les comptes', () => {
    expect(clearMessage({ status: 'cleared', before: null, after: 0 }).text).toBe('File vidée.')
    expect(clearMessage({ status: 'unchanged', before: null, after: null }).text).toBe("Spotify n'a pas vidé la file.")
  })

  it('distingue « rien ne joue » d’une file vide', () => {
    expect(clearMessage({ status: 'nothing_playing' })).toEqual({
      text: "Rien ne joue : il n'y a pas de file à vider.",
      ok: false,
    })
  })
})
