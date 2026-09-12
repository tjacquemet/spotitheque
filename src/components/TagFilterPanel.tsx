import { useState } from 'react'
import { normalize, plural } from '../lib/text'
import type { Filters, Tag } from '../lib/types'
import { TagFilterList } from './TagFilterList'

/** Au-delà de ce nombre de tags, un champ de recherche apparaît au-dessus de la liste. */
const SEARCH_THRESHOLD = 12

interface TagFilterPanelProps {
  tags: Tag[]
  counts: Map<number, number>
  filters: Filters
  untaggedCount: number
  removedCount: number
  active: boolean
  onToggle: (id: number) => void
  onToggleExclude: (id: number) => void
  setFilters: (update: (f: Filters) => Filters) => void
  onClear: () => void
}

/** Filtres par tags en colonne : filtres spéciaux, puis un tag par ligne. */
export function TagFilterPanel({
  tags,
  counts,
  filters,
  untaggedCount,
  removedCount,
  active,
  onToggle,
  onToggleExclude,
  setFilters,
  onClear,
}: TagFilterPanelProps) {
  const [query, setQuery] = useState('')
  const q = normalize(query.trim())
  const visible = q ? tags.filter((t) => normalize(t.name).includes(q)) : tags

  return (
    <div className="tag-panel">
      {tags.length > SEARCH_THRESHOLD && (
        <input
          className="input input-sm"
          type="search"
          value={query}
          placeholder="Filtrer les tags…"
          aria-label="Filtrer la liste des tags"
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      <ul className="tag-list special">
        <li className={`tag-row ${filters.untagged ? 'on' : 'off'}`}>
          <button
            type="button"
            className="tag-row-main"
            aria-pressed={filters.untagged}
            onClick={() => setFilters((f) => ({ ...f, untagged: !f.untagged }))}
          >
            <span className="tag-row-name">Sans tag</span>
            <span className="tag-row-count">{untaggedCount}</span>
          </button>
        </li>
        {removedCount > 0 && (
          <li className={`tag-row ${filters.removed ? 'on' : 'off'}`}>
            <button
              type="button"
              className="tag-row-main"
              aria-pressed={filters.removed}
              onClick={() => setFilters((f) => ({ ...f, removed: !f.removed }))}
            >
              <span className="tag-row-name">Retirés de Spotify</span>
              <span className="tag-row-count">{removedCount}</span>
            </button>
          </li>
        )}
      </ul>

      <TagFilterList
        tags={visible}
        counts={counts}
        include={filters.include}
        exclude={filters.exclude}
        onToggle={onToggle}
        onToggleExclude={onToggleExclude}
      />

      {tags.length === 0 && <p className="hint">Aucun tag pour l'instant : ouvre un album pour créer le premier.</p>}
      {tags.length > 0 && visible.length === 0 && <p className="hint">Aucun tag ne correspond.</p>}

      {active && (
        <button type="button" className="btn btn-sm clear-filters" onClick={onClear}>
          Effacer les filtres
        </button>
      )}
      {filters.include.length >= 2 && (
        <div className="panel-mode">
          <span className="hint">Albums avec</span>
          <div className="segmented" role="group" aria-label="Combinaison des tags">
            <button
              type="button"
              className={filters.mode === 'and' ? 'active' : ''}
              onClick={() => setFilters((f) => ({ ...f, mode: 'and' }))}
            >
              tous les tags
            </button>
            <button
              type="button"
              className={filters.mode === 'or' ? 'active' : ''}
              onClick={() => setFilters((f) => ({ ...f, mode: 'or' }))}
            >
              au moins un
            </button>
          </div>
        </div>
      )}
      {filters.exclude.length > 0 && (
        <p className="hint">Exclus : {plural(filters.exclude.length, 'tag', 'tags')}</p>
      )}
    </div>
  )
}
