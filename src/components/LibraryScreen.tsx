import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { SpotifyStatus } from '../../shared/api'
import { countTags, filterAlbums, hasActiveFilters, sortAlbums } from '../lib/filter'
import { plural } from '../lib/text'
import { EMPTY_FILTERS, type Filters, type SortKey, type Tag } from '../lib/types'
import { deleteAlbums, refreshLibrary, runSuggestions, runSync, useLibrary } from '../store'
import { toast, toastError } from '../toast'
import { AlbumGrid } from './AlbumGrid'
import { AlbumSheet } from './AlbumSheet'
import { BulkTagSheet } from './BulkTagSheet'
import { CloseIcon, DiceIcon, DiscIcon, SearchIcon, SelectIcon, SettingsIcon, SparkleIcon, SyncIcon, TagIcon, TrashIcon } from './Icons'
import { Sheet } from './Sheet'
import { TagChip, type ChipState } from './TagChip'
import { TagFilterPanel } from './TagFilterPanel'

const SORT_STORAGE = 'spotitheque.sort'
const HINT_STORAGE = 'spotitheque.hint-exclude'
const SORTS: Record<SortKey, string> = {
  played: 'Écoute',
  added: 'Ajout',
  artist: 'Artiste',
  title: 'Titre',
  year: 'Année',
  random: 'Aléatoire',
}

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
  onNavigate: (screen: 'tags' | 'settings' | 'suggestions') => void
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
  const [tagPanelOpen, setTagPanelOpen] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const suggestions = useLibrary((s) => s.suggestions)
  const suggestRun = useLibrary((s) => s.suggestRun)
  const pendingSuggestions = useMemo(
    () => [...suggestions.values()].reduce((n, list) => n + list.length, 0),
    [suggestions],
  )
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
  // Nombre d'albums qui resteraient en activant « Sans tag » / « Sans autre tag » avec les filtres actuels.
  const untaggedCount = useMemo(
    () => (data ? filterAlbums(data.albums, data.links, { ...effective, untagged: true }).length : 0),
    [data, effective],
  )
  const untaggedLabel = effective.include.length > 0 ? 'Sans autre tag' : 'Sans tag'
  const active = hasActiveFilters(effective)

  // Hauteur réelle de l'en-tête : la colonne de tags se colle juste en dessous.
  const topbar = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = topbar.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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

  const analyze = () => {
    const ids = analysisIds
    if (ids.length === 0) {
      toast('Aucun album à analyser.')
      return
    }
    if (ids.length > 150 && !window.confirm(`Analyser ${ids.length} albums ? Compte environ une minute par tranche de 20.`)) {
      return
    }
    runSuggestions(ids)
      .then((result) => {
        if (!result) return
        if (result.unavailable) {
          toast(
            result.suggested > 0
              ? `${plural(result.suggested, 'proposition', 'propositions')} — les bases musicales limitent les recherches, relance pour le reste.`
              : 'Les bases musicales limitent les recherches en ce moment : relance dans quelques minutes.',
            { tone: 'error', duration: 8000 },
          )
          return
        }
        if (result.suggested === 0) {
          toast('Aucune nouvelle proposition.')
          return
        }
        toast(`${plural(result.suggested, 'proposition', 'propositions')} à valider`, {
          action: { label: 'Voir', run: () => onNavigate('suggestions') },
        })
      })
      .catch(toastError)
  }

  const syncNow = () => {
    runSync(false)
      .then((r) => r && toast(r.added ? `${plural(r.added, 'nouvel album', 'nouveaux albums')}` : 'Bibliothèque à jour'))
      .catch(toastError)
  }

  const openAlbum = open ? data?.albumsById.get(open.id) : undefined
  const selecting = selection !== null

  // L'analyse porte sur la sélection quand il y en a une, sinon sur tout ce qui est affiché.
  const analysisIds = useMemo(
    () => (selection && selection.size > 0 ? [...selection] : results.map((a) => a.id)),
    [selection, results],
  )
  const analysisLabel =
    selection && selection.size > 0
      ? plural(analysisIds.length, 'album sélectionné', 'albums sélectionnés')
      : plural(analysisIds.length, 'album affiché', 'albums affichés')

  // Seuls les albums retirés de Spotify peuvent être supprimés de Spotithèque.
  const removedSelected = useMemo(
    () => (selection && data ? [...selection].filter((id) => data.albumsById.get(id)?.inLibrary === false) : []),
    [selection, data],
  )

  const deleteSelected = () => {
    const count = removedSelected.length
    const ok = window.confirm(
      `Supprimer définitivement ${plural(count, 'album retiré de Spotify', 'albums retirés de Spotify')} de Spotithèque, avec leurs tags ?`,
    )
    if (!ok) return
    deleteAlbums(removedSelected).catch(toastError)
    toast(plural(count, 'album supprimé', 'albums supprimés'))
    setSelection(new Set())
  }

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
        onSelectionChange={setSelection}
      />
    )
  }

  return (
    <>
      <header className="topbar" ref={topbar}>
        <div className="topbar-row">
          {selecting ? (
            <>
              <button type="button" className="icon-btn" onClick={() => setSelection(null)} aria-label="Annuler la sélection">
                <CloseIcon />
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setSelection(new Set(results.map((a) => a.id)))}>
                Tout sélectionner
              </button>
              <span className="spacer" />
              <strong className="topbar-title">{plural(selection.size, 'sélectionné', 'sélectionnés')}</strong>
            </>
          ) : (
            /* Titre puis actions, groupés à gauche et à portée du pouce. */
            <>
              <div className="brand">
                <DiscIcon size={22} className={sync ? 'spin' : undefined} />
                Spotithèque
              </div>
              <button type="button" className="icon-btn" onClick={() => setSelection(new Set())} aria-label="Sélectionner des albums">
                <SelectIcon />
              </button>
              <button type="button" className="icon-btn" onClick={() => onNavigate('tags')} aria-label="Gérer les tags">
                <TagIcon />
              </button>
              <button type="button" className="icon-btn" onClick={() => onNavigate('settings')} aria-label="Réglages">
                <SettingsIcon />
              </button>
              <span className="spacer" />
              {sync && sync.total > 0 && data && data.albums.length > 0 && (
                <span className="sync-note">
                  {sync.full ? `Synchro ${sync.done}/${sync.total}` : 'Synchro…'}
                </span>
              )}
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

        {/* Sur téléphone : bouton vers la liste complète, puis les tags actifs et les autres. */}
        {data && data.albums.length > 0 && (
          <div className="tagbar-row">
            <button type="button" className="chip tagbar-open" onClick={() => setTagPanelOpen(true)}>
              <TagIcon size={15} /> Tags
              {effective.include.length + effective.exclude.length > 0 && (
                <span className="chip-badge">{effective.include.length + effective.exclude.length}</span>
              )}
            </button>
            <div className="tagbar" role="toolbar" aria-label="Filtrer par tags" ref={tagbar}>
              {activeTags.map(renderTag)}
              {activeTags.length > 0 && <span className="tagbar-sep" />}
              <TagChip
                label={untaggedLabel}
                count={untaggedCount}
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
          </div>
        )}
      </header>

      <div className="library-body">
        {data && data.albums.length > 0 && (
          <aside className="sidebar" aria-label="Filtrer par tags">
            <TagFilterPanel
              tags={data.tags}
              counts={counts}
              filters={effective}
              untaggedCount={untaggedCount}
              untaggedLabel={untaggedLabel}
              removedCount={removedCount}
              active={active}
              onToggle={tapTag}
              onToggleExclude={longPressTag}
              setFilters={setFilters}
              onClear={() => setFilters(EMPTY_FILTERS)}
            />
          </aside>
        )}

        <div className="library-main">
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
          <button
            type="button"
            className="icon-btn suggest-btn"
            onClick={() => setSuggestOpen(true)}
            aria-label="Suggestions de tags"
            title="Suggestions de tags"
          >
            <SparkleIcon />
            {pendingSuggestions > 0 && <span className="badge">{pendingSuggestions}</span>}
          </button>
          <button type="button" className="icon-btn accent" onClick={surprise} aria-label="Surprends-moi" title="Surprends-moi">
            <DiceIcon />
          </button>
        </div>
      )}

      {!hintSeen && effective.include.length > 0 && effective.exclude.length === 0 && (
        <p className="hint hint-bar">Astuce : un appui long sur un tag exclut les albums qui l'ont.</p>
      )}

          <main>{body}</main>
        </div>
      </div>

      {selecting && (
        <div className="selection-bar">
          <span>{plural(selection.size, 'album', 'albums')}</span>
          {removedSelected.length > 0 && (
            <button type="button" className="btn btn-danger btn-sm" onClick={deleteSelected}>
              <TrashIcon size={16} /> Supprimer {removedSelected.length}
            </button>
          )}
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
      {suggestOpen && (
        <Sheet onClose={() => setSuggestOpen(false)} label="Suggestions de tags">
          <h2 className="sheet-title">Suggestions de tags</h2>
          <p className="hint">
            Chaque album est retrouvé dans MusicBrainz, l'encyclopédie musicale libre, et c'est sa fiche — jamais les
            données Spotify — qui est analysée avec la liste de tes tags. Tu valides ensuite chaque proposition.
          </p>
          {suggestRun ? (
            <>
              <div className="progress" aria-hidden="true">
                <div style={{ width: `${suggestRun.total ? (100 * suggestRun.done) / suggestRun.total : 0}%` }} />
              </div>
              <p className="hint">
                Analyse en cours : {suggestRun.done} / {suggestRun.total} albums. Tu peux fermer cette fenêtre, ça continue.
              </p>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-block" onClick={analyze}>
              <SparkleIcon /> Analyser {analysisLabel}
            </button>
          )}
          {pendingSuggestions > 0 && (
            <button
              type="button"
              className="btn btn-block"
              onClick={() => {
                setSuggestOpen(false)
                onNavigate('suggestions')
              }}
            >
              Voir {plural(pendingSuggestions, 'proposition', 'propositions')}
            </button>
          )}
        </Sheet>
      )}
      {tagPanelOpen && data && (
        <Sheet onClose={() => setTagPanelOpen(false)} label="Filtrer par tags">
          <h2 className="sheet-title">Filtrer par tags</h2>
          <TagFilterPanel
            tags={data.tags}
            counts={counts}
            filters={effective}
            untaggedCount={untaggedCount}
            untaggedLabel={untaggedLabel}
            removedCount={removedCount}
            active={active}
            onToggle={tapTag}
            onToggleExclude={longPressTag}
            setFilters={setFilters}
            onClear={() => setFilters(EMPTY_FILTERS)}
          />
          <button type="button" className="btn btn-block" onClick={() => setTagPanelOpen(false)}>
            Voir les {plural(results.length, 'album', 'albums')}
          </button>
        </Sheet>
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
