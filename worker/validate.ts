import type { ArtistRef, SyncAlbum } from '../shared/api'
import { TAG_COLORS, TAG_NAME_MAX, normalizeTagName } from '../shared/tags'
import { badRequest } from './errors'

const SPOTIFY_ID = /^[A-Za-z0-9]{1,64}$/

export function parseSpotifyId(v: unknown): string {
  if (typeof v !== 'string' || !SPOTIFY_ID.test(v)) throw badRequest('Identifiant Spotify invalide.')
  return v
}

/** Rang de la piste à laquelle démarrer l'album ; absent, la lecture commence au début. */
export function parseTrackPosition(v: unknown): number {
  if (v === undefined || v === null) return 0
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 500) throw badRequest('Piste invalide.')
  return v
}

export function parseTagId(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw badRequest('Identifiant de tag invalide.')
  return n
}

export function parseTagName(v: unknown): { name: string; key: string } {
  if (typeof v !== 'string') throw badRequest('Nom de tag invalide.')
  const tag = normalizeTagName(v)
  if (!tag.name || tag.name.length > TAG_NAME_MAX) {
    throw badRequest(`Le nom d'un tag doit faire entre 1 et ${TAG_NAME_MAX} caractères.`)
  }
  return tag
}

export function parseColor(v: unknown): string {
  if (typeof v !== 'string' || !(TAG_COLORS as readonly string[]).includes(v)) throw badRequest('Couleur invalide.')
  return v
}

export function parseList<T>(v: unknown, max: number, item: (x: unknown) => T): T[] {
  if (!Array.isArray(v)) throw badRequest('Liste attendue.')
  if (v.length > max) throw badRequest(`Trop d'éléments (maximum ${max}).`)
  return v.map(item)
}

export function asObject(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw badRequest('Objet JSON attendu.')
  return v as Record<string, unknown>
}

function optString(v: unknown, max: number): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || v.length > max) throw badRequest('Champ texte invalide.')
  return v
}

function optImage(v: unknown): string | null {
  const url = optString(v, 500)
  if (url && !url.startsWith('https://')) throw badRequest("URL d'image invalide.")
  return url
}

function optCount(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100_000) throw badRequest('Nombre invalide.')
  return v
}

function parseArtists(v: unknown): ArtistRef[] {
  return parseList(v, 50, (a) => {
    const o = asObject(a)
    if (typeof o.name !== 'string' || !o.name || o.name.length > 300) throw badRequest('Artiste invalide.')
    return { id: typeof o.id === 'string' ? o.id.slice(0, 64) : '', name: o.name }
  })
}

export function parseSyncAlbum(v: unknown): SyncAlbum {
  const o = asObject(v)
  const name = optString(o.name, 500)
  if (!name) throw badRequest("Titre d'album manquant.")
  return {
    id: parseSpotifyId(o.id),
    name,
    artists: parseArtists(o.artists),
    image: optImage(o.image),
    imageLarge: optImage(o.imageLarge),
    releaseDate: optString(o.releaseDate, 10),
    totalTracks: optCount(o.totalTracks),
    upc: optString(o.upc, 32),
    addedAt: optString(o.addedAt, 40),
  }
}
