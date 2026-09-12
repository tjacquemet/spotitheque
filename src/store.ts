import { useSyncExternalStore } from 'react'
import type { AlbumRow, LibraryPayload, SyncAlbum } from '../shared/api'
import { normalizeTagName, tagSortKey } from '../shared/tags'
import { api } from './api'
import { idbDelete, idbGet, idbSet } from './lib/idb'
import { logAction } from './lib/activity'
import { lookupAlbums } from './lib/lookup'
import { SAVED_ALBUMS_URL, SpotifyTokenRejected, fetchSavedAlbumsPage, isUnchanged, toSyncAlbum } from './lib/spotify'
import { compareText, normalize } from './lib/text'
import type { Album, LibraryData, Tag } from './lib/types'

// État de la bibliothèque : chargé depuis le cache local puis le serveur, modifié de façon optimiste.

export interface SyncProgress {
  full: boolean
  done: number
  total: number
}

export interface Suggestion {
  label: string
  tagId: number | null
  source: string
}

export interface SuggestProgress {
  done: number
  total: number
}

interface State {
  data: LibraryData | null
  loadError: string | null
  sync: SyncProgress | null
  /** Propositions de tags en attente, par album. */
  suggestions: Map<string, Suggestion[]>
  suggestRun: SuggestProgress | null
}

let state: State = { data: null, loadError: null, sync: null, suggestions: new Map(), suggestRun: null }
const listeners = new Set<() => void>()

function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Le sélecteur doit renvoyer une valeur stable (un champ de l'état, pas un nouvel objet). */
export function useLibrary<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export const getLibrary = () => state.data

// --- Conversion entre la réponse compacte du serveur et les structures de l'interface ---

function rowToAlbum([
  id,
  name,
  artists,
  image,
  imageLarge,
  releaseDate,
  totalTracks,
  addedAt,
  inLibrary,
  lastPlayedAt,
]: AlbumRow): Album {
  const artistNames = artists.map((a) => a.name).join(', ')
  const year = releaseDate ? Number(releaseDate.slice(0, 4)) || null : null
  return {
    id,
    name,
    artists,
    artistNames,
    image,
    imageLarge,
    releaseDate,
    year,
    totalTracks,
    addedAt,
    inLibrary: inLibrary === 1,
    lastPlayedAt: lastPlayedAt ?? null,
    searchText: normalize(`${name} ${artistNames}`),
  }
}

/** Tags classés par nom, les genres musicaux regroupés à la fin. */
function withTags(d: LibraryData, tags: Tag[]): LibraryData {
  const sorted = [...tags].sort(
    (a, b) =>
      Number(a.isGenre) - Number(b.isGenre) ||
      compareText(tagSortKey(a.name), tagSortKey(b.name)) ||
      compareText(a.name, b.name),
  )
  return { ...d, tags: sorted, tagsById: new Map(sorted.map((t) => [t.id, t])) }
}

export function fromPayload(p: LibraryPayload): LibraryData {
  const albums = p.albums.map(rowToAlbum)
  const links = new Map<string, Set<number>>()
  for (const [albumId, tagId] of p.links) {
    let set = links.get(albumId)
    if (!set) links.set(albumId, (set = new Set()))
    set.add(tagId)
  }
  const base: LibraryData = { version: p.version, albums, albumsById: new Map(albums.map((a) => [a.id, a])), tags: [], tagsById: new Map(), links }
  return withTags(base, p.tags.map(([id, name, color, isGenre]) => ({ id, name, color, isGenre: isGenre === 1 })))
}

function toPayload(d: LibraryData): LibraryPayload {
  return {
    version: d.version,
    albums: d.albums.map((a) => [
      a.id,
      a.name,
      a.artists,
      a.image,
      a.imageLarge,
      a.releaseDate,
      a.totalTracks,
      a.addedAt,
      a.inLibrary ? 1 : 0,
      a.lastPlayedAt,
    ]),
    tags: d.tags.map((t) => [t.id, t.name, t.color, t.isGenre ? 1 : 0]),
    links: [...d.links].flatMap(([albumId, tags]) => [...tags].map((tagId): [string, number] => [albumId, tagId])),
  }
}

// --- Cache local ---

const CACHE_KEY = 'library'
let persistTimer: ReturnType<typeof setTimeout> | undefined

function setData(data: LibraryData) {
  setState({ data })
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    if (state.data) void idbSet(CACHE_KEY, toPayload(state.data))
  }, 800)
}

// --- Chargement ---

/** Les écritures partent dans l'ordre, une à la fois : l'état optimiste reste cohérent avec le serveur. */
let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  queue = run.catch(() => undefined)
  return run
}

let refreshing: Promise<void> | null = null

/** Recharge la bibliothèque si elle a changé (ETag), après les écritures en attente. */
export function refreshLibrary(): Promise<void> {
  refreshing ??= (async () => {
    try {
      await queue
      const payload = await api.library(state.data?.version)
      if (payload) setData(fromPayload(payload))
      setState({ loadError: null })
    } catch (err) {
      setState({ loadError: err instanceof Error ? err.message : String(err) })
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function loadLibrary(): Promise<void> {
  if (!state.data) {
    const cached = await idbGet<LibraryPayload>(CACHE_KEY)
    if (cached && !state.data) setState({ data: fromPayload(cached) })
  }
  await refreshLibrary()
}

export async function resetLibrary(): Promise<void> {
  clearTimeout(persistTimer)
  state = { data: null, loadError: null, sync: null, suggestions: new Map(), suggestRun: null }
  listeners.forEach((listener) => listener())
  await idbDelete(CACHE_KEY)
}

/** Une écriture a produit la version `next` : si c'est la suivante, l'état local est à jour ; sinon on recharge. */
function confirmVersion(next: number | null | undefined) {
  const d = state.data
  if (!d || next === null || next === undefined) return
  if (next === d.version + 1) setData({ ...d, version: next })
  else void refreshLibrary()
}

function optimistic(update: (d: LibraryData) => LibraryData, send: () => Promise<{ version: number | null }>): Promise<void> {
  const d = state.data
  if (!d) return Promise.resolve()
  setData(update(d))
  return enqueue(async () => {
    try {
      confirmVersion((await send()).version)
    } catch (err) {
      void refreshLibrary()
      throw err
    }
  })
}

// --- Tags ---

export function applyTags(albumIds: string[], add: number[], remove: number[]): Promise<void> {
  if (albumIds.length === 0 || add.length + remove.length === 0) return Promise.resolve()
  return optimistic(
    (d) => {
      const links = new Map(d.links)
      for (const id of albumIds) {
        const next = new Set(links.get(id))
        for (const t of add) next.add(t)
        for (const t of remove) next.delete(t)
        if (next.size > 0) links.set(id, next)
        else links.delete(id)
      }
      return { ...d, links }
    },
    () => api.setAlbumTags(albumIds, add, remove),
  )
}

/** Supprime définitivement des albums retirés de Spotify (les albums encore présents sont ignorés). */
export function deleteAlbums(albumIds: string[]): Promise<void> {
  const ids = albumIds.filter((id) => state.data?.albumsById.get(id)?.inLibrary === false)
  if (ids.length === 0) return Promise.resolve()
  const removed = new Set(ids)
  return optimistic(
    (d) => {
      const albums = d.albums.filter((a) => !removed.has(a.id))
      const links = new Map(d.links)
      for (const id of removed) links.delete(id)
      return { ...d, albums, albumsById: new Map(albums.map((a) => [a.id, a])), links }
    },
    () => api.deleteAlbums(ids),
  )
}

export function createTag(name: string): Promise<Tag> {
  return enqueue(async () => {
    const { tag, version } = await api.createTag(name)
    const d = state.data
    if (d && !d.tagsById.has(tag.id)) setData(withTags(d, [...d.tags, tag]))
    confirmVersion(version)
    return tag
  })
}

export function updateTag(id: number, patch: { name?: string; color?: string; isGenre?: boolean }): Promise<void> {
  const clean = patch.name !== undefined ? { ...patch, name: normalizeTagName(patch.name).name } : patch
  return optimistic(
    (d) => withTags(d, d.tags.map((t) => (t.id === id ? { ...t, ...clean } : t))),
    () => api.updateTag(id, clean),
  )
}

function replaceTagInLinks(links: Map<string, Set<number>>, id: number, into: number | null): Map<string, Set<number>> {
  const next = new Map<string, Set<number>>()
  for (const [albumId, tags] of links) {
    if (!tags.has(id)) {
      next.set(albumId, tags)
      continue
    }
    const updated = new Set(tags)
    updated.delete(id)
    if (into !== null) updated.add(into)
    if (updated.size > 0) next.set(albumId, updated)
  }
  return next
}

export function deleteTag(id: number): Promise<void> {
  return optimistic(
    (d) => ({ ...withTags(d, d.tags.filter((t) => t.id !== id)), links: replaceTagInLinks(d.links, id, null) }),
    () => api.deleteTag(id),
  )
}

export function mergeTag(id: number, into: number): Promise<void> {
  return optimistic(
    (d) => ({ ...withTags(d, d.tags.filter((t) => t.id !== id)), links: replaceTagInLinks(d.links, id, into) }),
    () => api.mergeTag(id, into),
  )
}

export async function importBackup(file: unknown) {
  const result = await enqueue(() => api.importTags(file))
  await refreshLibrary()
  return result
}

// --- Suggestions de tags ---

export async function loadSuggestions(): Promise<void> {
  const { items } = await api.suggestions()
  const byAlbum = new Map<string, Suggestion[]>()
  for (const [albumId, label, tagId, source] of items) {
    const list = byAlbum.get(albumId) ?? []
    list.push({ label, tagId, source })
    byAlbum.set(albumId, list)
  }
  setState({ suggestions: byAlbum })
}

function dropSuggestion(albumId: string, label?: string) {
  const suggestions = new Map(state.suggestions)
  if (!label) suggestions.delete(albumId)
  else {
    const rest = (suggestions.get(albumId) ?? []).filter((s) => s.label !== label)
    if (rest.length > 0) suggestions.set(albumId, rest)
    else suggestions.delete(albumId)
  }
  setState({ suggestions })
}

/** Accepte une proposition : le tag est créé au besoin, posé sur l'album, et la proposition disparaît. */
export function acceptSuggestion(albumId: string, label: string): Promise<void> {
  dropSuggestion(albumId, label)
  return enqueue(async () => {
    const { tag, version } = await api.acceptSuggestion(albumId, label)
    const d = state.data
    if (d) {
      const withTag = d.tagsById.has(tag.id) ? d : withTags(d, [...d.tags, tag])
      const links = new Map(withTag.links)
      links.set(albumId, new Set([...(links.get(albumId) ?? []), tag.id]))
      setData({ ...withTag, links })
    }
    confirmVersion(version)
  })
}

export function rejectSuggestion(albumId: string, label?: string): Promise<void> {
  dropSuggestion(albumId, label)
  return enqueue(() => api.rejectSuggestion(albumId, label).then(() => undefined))
}

let suggesting = false

/**
 * Analyse une liste d'albums par petites passes : enrichissement MusicBrainz puis appel au modèle.
 * L'appli rappelle le serveur tant qu'il reste des albums à traiter.
 */
export async function runSuggestions(albumIds: string[]): Promise<{ suggested: number; unavailable: boolean } | null> {
  if (suggesting || albumIds.length === 0) return null
  suggesting = true
  setState({ suggestRun: { done: 0, total: albumIds.length } })
  logAction('analyse.lancee', { albums: albumIds.length })
  let suggested = 0
  let unavailable = false
  try {
    let first = true
    let lastRemaining = Number.POSITIVE_INFINITY
    for (let pass = 0; pass < 200; pass++) {
      // Le navigateur cherche lui-même les fiches MusicBrainz, puis le serveur fait analyser le lot.
      const plan = await api.suggestPlan(albumIds)
      setState({ suggestRun: { done: Math.max(0, albumIds.length - plan.remaining), total: albumIds.length } })
      if (plan.toEnrich.length > 0) {
        const lookup = await lookupAlbums(plan.toEnrich)
        if (lookup.records.length > 0) await api.saveMusicBrainz(lookup.records)
        if (lookup.unavailable && lookup.records.length === 0) {
          unavailable = true
          break
        }
      }
      const result = await api.runSuggestions(albumIds, first)
      first = false
      suggested += result.suggested
      setState({ suggestRun: { done: Math.max(0, albumIds.length - result.remaining), total: albumIds.length } })
      if (result.remaining === 0) break
      if (plan.toEnrich.length === 0 && result.analyzed === 0) break
      // Rien de nouveau cherché et le compte n'a pas bougé : insister ferait tourner le modèle pour rien.
      if (plan.toEnrich.length === 0 && result.remaining >= lastRemaining) break
      lastRemaining = result.remaining
    }
    await loadSuggestions()
    await refreshLibrary()
    logAction('analyse.terminee', { albums: albumIds.length, propositions: suggested, basesIndisponibles: unavailable })
    return { suggested, unavailable }
  } finally {
    suggesting = false
    setState({ suggestRun: null })
  }
}

// --- Synchronisation avec Spotify ---

let syncing = false

/**
 * Lit la bibliothèque Spotify dans le navigateur et n'envoie au serveur que les albums nouveaux ou modifiés.
 * Incrémentale : s'arrête au premier album déjà connu. Complète : parcourt tout et signale les albums retirés.
 */
export async function runSync(full: boolean): Promise<{ added: number; removed: number } | null> {
  if (syncing) return null
  syncing = true
  setState({ sync: { full, done: 0, total: 0 } })
  try {
    const known = state.data?.albumsById ?? new Map<string, Album>()
    let token = await api.spotifyToken()
    const allIds: string[] = []
    const changed: SyncAlbum[] = []
    let url: string | null = SAVED_ALBUMS_URL
    let total = 0
    while (url) {
      if (token.expiresAt - Date.now() < 30_000) token = await api.spotifyToken()
      let page
      try {
        page = await fetchSavedAlbumsPage(url, token.accessToken)
      } catch (err) {
        if (!(err instanceof SpotifyTokenRejected)) throw err
        token = await api.spotifyToken()
        page = await fetchSavedAlbumsPage(url, token.accessToken)
      }
      total = page.total
      let reachedKnown = false
      for (const item of page.items) {
        const album = toSyncAlbum(item)
        allIds.push(album.id)
        const existing = known.get(album.id)
        if (existing && isUnchanged(existing, album)) {
          if (!full) {
            reachedKnown = true
            break
          }
        } else {
          changed.push(album)
        }
      }
      setState({ sync: { full, done: allIds.length, total } })
      url = reachedKnown ? null : page.next
    }

    for (let i = 0; i < changed.length; i += 300) await api.syncAlbums(changed.slice(i, i + 300))
    let removed = 0
    if (full) {
      // Un parcours incomplet (bibliothèque modifiée pendant la synchro) ne doit rien retirer.
      if (allIds.length < total) throw new Error('La bibliothèque a changé pendant la synchronisation : réessaie.')
      removed = (await api.syncFinish(allIds)).removed
    }
    await refreshLibrary()
    const added = changed.filter((a) => !known.get(a.id)?.inLibrary).length
    logAction('sync', { complete: full, lus: allIds.length, modifies: changed.length, ajoutes: added, retires: removed })
    return { added, removed }
  } finally {
    syncing = false
    setState({ sync: null })
  }
}
