import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { SpotifyStatus } from '../../shared/api'
import { countTags, filterAlbums, hasActiveFilters, sortAlbums } from '../lib/filter'
import { plural } from '../lib/text'
import { EMPTY_FILTERS, type Filters, type SortKey, type Tag } from '../lib/types'
import { refreshLibrary, runSync, useLibrary } from '../store'
import { toast, toastError } from '../toast'
import { AlbumGrid } from './AlbumGrid'
import { AlbumSheet } from './AlbumSheet'
import { BulkTagSheet } from './BulkTagSheet'
import { CloseIcon, DiceIcon, DiscIcon, SearchIcon, SelectIcon, SettingsIcon, SyncIcon, TagIcon } from './Icons'
import { TagChip, type ChipState } from './TagChip'

const SORT_STORAGE = 'spotitheque.sort'
const HINT_STORAGE = 'spotitheque.hint-exclude'
const SORTS: Record<SortKey, string> = { added: 'Ajout', artist: 'Artiste', title: 'Titre', year: 'Année', random: 'Aléatoire' }

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Préférence facultative.
  }
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31)

interface Props {
  spotify: SpotifyStatus | null
  onNavigate: (screen: 'tags' | 'settings') => void
}

export function LibraryScreen({ spotify, onNavigate }: Props) {
  const data = useLibrary((s) => s.data)
  const sync = useLibrary((s) => s.sync)
  const loadError = useLibrary((s) => s.loadError)

  // Les filtres repartent de zéro à chaque ouverture ; seul le tri est mémorisé.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sort, setSortState] = useState<SortKey>(() => {
    const saved = readStorage(SORT_STORAGE)
    return saved && saved in SORTS ? (saved as SortKey) : 'added'
  })
  const [seed, setSeed] = useState(newSeed)
  const [selection, setSelection] = useState<Set<string> | null>(null)
  const [open, setOpen] = useState<{ id: string; random: boolean } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [hintSeen, setHintSeen] = useState(() => readStorage(HINT_STORAGE) === '1')
  const query = useDeferredValue(filters.query)

  const effective = useMemo<Filters>(() => {
    const known = (ids: number[]) => (data ? ids.filter((id) => data.tagsById.has(id)) : ids)
    return { ...filters, query, include: known(filters.include), exclude: known(filters.exclude) }
  }, [filters, query, data])

  const results = useMemo(
    () => (data ? sortAlbums(filterAlbums(data.albums, data.links, effective), sort, seed) : []),
    [data, effective, sort, seed],
  )
  const counts = useMemo(() => (data ? countTags(results, data.links) : new Map<number, number>()), [data, results])
  const removedCount = useMemo(() => data?.albums.filter((a) => !a.inLibrary).length ?? 0, [data])
  const active = hasActiveFilters(effective)

  // Les tags actifs passent en tête de la barre, qui revient au début : ils restent visibles.
  const { activeTags, otherTags } = useMemo(() => {
    if (!data) return { activeTags: [], otherTags: [] }
    const ids = [...effective.include, ...effective.exclude]
    return {
      activeTags: ids.map((id) => data.tagsById.get(id)!),
      otherTags: data.tags.filter((t) => !ids.includes(t.id)),
    }
  }, [data, effective.include, effective.exclude])
  const tagbar = useRef<HTMLDivElement>(null)
  const activeKey = `${effective.include.join()}|${effective.exclude.join()}`
  useEffect(() => {
    tagbar.current?.scrollTo({ left: 0, behavior: 'smooth' })
  }, [activeKey])

  const setSort = (value: SortKey) => {
    setSortState(value)
    writeStorage(SORT_STORAGE, value)
    if (value === 'random') setSeed(newSeed())
  }

  const tagState = (id: number): ChipState =>
    effective.include.includes(id) ? 'on' : effective.exclude.includes(id) ? 'excluded' : 'off'

  const tapTag = (id: number) =>
    setFilters((f) => {
      if (f.exclude.includes(id)) return { ...f, exclude: f.exclude.filter((x) => x !== id) }
      if (f.include.includes(id)) return { ...f, include: f.include.filter((x) => x !== id) }
      return { ...f, include: [...f.include, id] }
    })

  const longPressTag = (id: number) => {
    if (!hintSeen) {
      setHintSeen(true)
      writeStorage(HINT_STORAGE, '1')
    }
    setFilters((f) =>
      f.exclude.includes(id)
        ? { ...f, exclude: f.exclude.filter((x) => x !== id) }
        : { ...f, exclude: [...f.exclude, id], include: f.include.filter((x) => x !== id) },
    )
  }

  const renderTag = (tag: Tag) => {
    const state = tagState(tag.id)
    const count = counts.get(tag.id) ?? 0
    return (
      <TagChip
        key={tag.id}
        label={tag.name}
        color={tag.color}
        state={state}
        count={state === 'excluded' ? undefined : count}
        muted={state === 'off' && count === 0}
        onClick={() => tapTag(tag.id)}
        onLongPress={() => longPressTag(tag.id)}
        title="Toucher pour filtrer, appui long pour exclure"
      />
    )
  }

  const onOpen = useCallback((id: string) => setOpen({ id, random: false }), [])
  const onSelect = useCallback(
    (id: string) =>
      setSelection((current) => {
        const next = new Set(current ?? [])
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    [],
  )

  const surprise = () => {
    const pool = results.filter((a) => a.id !== open?.id)
    if (pool.length === 0) {
      toast('Aucun album à tirer au sort avec ces filtres.')
      return
    }
    setOpen({ id: pool[Math.floor(Math.random() * pool.length)].id, random: true })
  }

  const syncNow = () => {
    runSync(false)
      .then((r) => r && toast(r.added ? `${plural(r.added, 'nouvel album', 'nouveaux albums')}` : 'Bibliothèque à jour'))
      .catch(toastError)
  }

  const openAlbum = open ? data?.albumsById.get(open.id) : undefined
  const selecting = selection !== null

  let body
  if (!data) {
    body = loadError ? (
      <div className="empty">
        <p>{loadError}</p>
        <button type="button" className="btn" onClick={() => void refreshLibrary()}>
          Réessayer
        </button>
      </div>
    ) : (
      <div className="empty">Chargement…</div>
    )
  } else if (data.albums.length === 0) {
    body = sync ? (
      <div className="empty import">
        <DiscIcon size={40} className="spin" />
        <p className="import-title">Import de ta bibliothèque…</p>
        <div className="progress" aria-hidden="true">
          <div style={{ width: sync.total ? `${(100 * sync.done) / sync.total}%` : '4%' }} />
        </div>
        <p className="hint">{sync.total ? `${sync.done} / ${sync.total} albums` : 'Connexion à Spotify…'}</p>
      </div>
    ) : spotify === 'connected' ? (
      <div className="empty">
        <p>Aucun album dans ta bibliothèque pour l'instant.</p>
        <button type="button" className="btn" onClick={syncNow}>
          <SyncIcon /> Synchroniser avec Spotify
        </button>
      </div>
    ) : (
      <div className="empty">
        <p>Connecte ton compte Spotify pour importer tes albums.</p>
        <a className="btn btn-primary" href="/api/auth/login">
          Connecter Spotify
        </a>
      </div>
    )
  } else if (results.length === 0) {
    body = (
      <div className="empty">
        <p>Aucun album ne correspond.</p>
        {active && (
          <button type="button" className="btn" onClick={() => setFilters(EMPTY_FILTERS)}>
            Effacer les filtres
          </button>
        )}
      </div>
    )
  } else {
    body = (
      <AlbumGrid
        albums={results}
        links={data.links}
        tagsById={data.tagsById}
        selection={selection}
        onOpen={onOpen}
        onSelect={onSelect}
      />
    )
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-row">
          {selecting ? (
            <>
              <button type="button" className="icon-btn" onClick={() => setSelection(null)} aria-label="Annuler la sélection">
                <CloseIcon />
              </button>
              <strong className="topbar-title">{plural(selection.size, 'sélectionné', 'sélectionnés')}</strong>
              <span className="spacer" />
              <button type="button" className="btn btn-sm" onClick={() => setSelection(new Set(results.map((a) => a.id)))}>
                Tout sélectionner
              </button>
            </>
          ) : (
            <>
              <div className="brand">
                <DiscIcon size={22} className={sync ? 'spin' : undefined} />
                Spotithèque
              </div>
              {sync && sync.total > 0 && data && data.albums.length > 0 && (
                <span className="sync-note">
                  {sync.full ? `Synchro ${sync.done}/${sync.total}` : 'Synchro…'}
                </span>
              )}
              <span className="spacer" />
              <button type="button" className="icon-btn" onClick={() => setSelection(new Set())} aria-label="Sélectionner des albums">
                <SelectIcon />
              </button>
              <button type="button" className="icon-btn" onClick={() => onNavigate('tags')} aria-label="Gérer les tags">
                <TagIcon />
              </button>
              <button type="button" className="icon-btn" onClick={() => onNavigate('settings')} aria-label="Réglages">
                <SettingsIcon />
              </button>
            </>
          )}
        </div>

        <div className="search">
          <SearchIcon size={18} className="search-icon" />
          <input
            type="search"
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            placeholder="Album ou artiste"
            aria-label="Rechercher un album ou un artiste"
            enterKeyHint="search"
            autoCorrect="off"
          />
          {filters.query && (
            <button type="button" className="clear" onClick={() => setFilters((f) => ({ ...f, query: '' }))} aria-label="Effacer la recherche">
              <CloseIcon size={16} />
            </button>
          )}
        </div>

        {data && (data.tags.length > 0 || removedCount > 0 || data.albums.length > 0) && (
          <div className="tagbar" role="toolbar" aria-label="Filtrer par tags" ref={tagbar}>
            {activeTags.map(renderTag)}
            {activeTags.length > 0 && <span className="tagbar-sep" />}
            <TagChip
              label="Sans tag"
              state={filters.untagged ? 'on' : 'off'}
              onClick={() => setFilters((f) => ({ ...f, untagged: !f.untagged }))}
            />
            {removedCount > 0 && (
              <TagChip
                label="Retirés de Spotify"
                count={removedCount}
                state={filters.removed ? 'on' : 'off'}
                onClick={() => setFilters((f) => ({ ...f, removed: !f.removed }))}
              />
            )}
            {otherTags.length > 0 && <span className="tagbar-sep" />}
            {otherTags.map(renderTag)}
          </div>
        )}
      </header>

      {data && data.albums.length > 0 && (
        <div className="toolbar">
          <span className="result-count">{plural(results.length, 'album', 'albums')}</span>
          {effective.include.length >= 2 && (
            <div className="segmented" role="group" aria-label="Combinaison des tags">
              <button type="button" className={effective.mode === 'and' ? 'active' : ''} onClick={() => setFilters((f) => ({ ...f, mode: 'and' }))} title="Tous les tags">
                ET
              </button>
              <button type="button" className={effective.mode === 'or' ? 'active' : ''} onClick={() => setFilters((f) => ({ ...f, mode: 'or' }))} title="Au moins un tag">
                OU
              </button>
            </div>
          )}
          {active && (
            <button type="button" className="link-btn" onClick={() => setFilters(EMPTY_FILTERS)}>
              Effacer
            </button>
          )}
          <span className="spacer" />
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Trier par">
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="icon-btn accent" onClick={surprise} aria-label="Surprends-moi" title="Surprends-moi">
            <DiceIcon />
          </button>
        </div>
      )}

      {!hintSeen && effective.include.length > 0 && effective.exclude.length === 0 && (
        <p className="hint hint-bar">Astuce : un appui long sur un tag exclut les albums qui l'ont.</p>
      )}

      <main>{body}</main>

      {selecting && (
        <div className="selection-bar">
          <span>{plural(selection.size, 'album', 'albums')}</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={selection.size === 0} onClick={() => setBulkOpen(true)}>
            <TagIcon size={16} /> Taguer
          </button>
        </div>
      )}

      {openAlbum && (
        <AlbumSheet
          album={openAlbum}
          spotify={spotify}
          onClose={() => setOpen(null)}
          onAnother={open?.random ? surprise : undefined}
        />
      )}
      {bulkOpen && selection && (
        <BulkTagSheet
          albumIds={[...selection]}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false)
            setSelection(new Set())
          }}
        />
      )}
    </>
  )
}
