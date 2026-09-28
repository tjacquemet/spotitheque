import { useState, type FormEvent } from 'react'
import { TAG_NAME_MAX, normalizeTagName } from '../../shared/tags'
import { SHORT_LABEL } from '../lib/filter'
import { normalize, plural } from '../lib/text'
import type { Filters, Tag } from '../lib/types'
import { createTag } from '../store'
import { toast, toastError } from '../toast'
import { PlusIcon } from './Icons'
import { TagFilterList } from './TagFilterList'

/** Au-delà de ce nombre de tags, un champ de recherche apparaît au-dessus de la liste. */
const SEARCH_THRESHOLD = 12

interface TagFilterPanelProps {
  tags: Tag[]
  counts: Map<number, number>
  filters: Filters
  untaggedCount: number
  /** « Sans tag » ou « Sans autre tag » selon qu'un tag est déjà sélectionné. */
  untaggedLabel: string
  /** Albums courts parmi ceux qu'affichent les filtres actuels. */
  shortCount: number
  removedCount: number
  hiddenCount: number
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
  untaggedLabel,
  shortCount,
  removedCount,
  hiddenCount,
  active,
  onToggle,
  onToggleExclude,
  setFilters,
  onClear,
}: TagFilterPanelProps) {
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const q = normalize(query.trim())
  const visible = q ? tags.filter((t) => normalize(t.name).includes(q)) : tags

  const create = async (e: FormEvent) => {
    e.preventDefault()
    const name = normalizeTagName(newName ?? '').name
    if (!name || busy) return
    setBusy(true)
    try {
      const tag = await createTag(name)
      toast(`Tag « ${tag.name} » créé`)
      setNewName(null)
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tag-panel">
      {newName === null ? (
        <button type="button" className="btn btn-sm new-tag" onClick={() => setNewName('')}>
          <PlusIcon size={16} /> Nouveau tag
        </button>
      ) : (
        <form className="inline-form new-tag-form" onSubmit={create}>
          <input
            className="input input-sm"
            autoFocus
            value={newName}
            maxLength={TAG_NAME_MAX}
            placeholder="Nom du tag"
            aria-label="Nom du nouveau tag"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNewName(null)}
          />
          <button type="submit" className="btn btn-sm btn-primary" disabled={!newName.trim() || busy}>
            Créer
          </button>
        </form>
      )}

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
            <span className="tag-row-name">{untaggedLabel}</span>
            <span className="tag-row-count">{untaggedCount}</span>
          </button>
        </li>
        <li className={`tag-row ${filters.short ? 'on' : 'off'}`}>
          <button
            type="button"
            className="tag-row-main"
            aria-pressed={filters.short}
            onClick={() => setFilters((f) => ({ ...f, short: !f.short }))}
          >
            <span className="tag-row-name">{SHORT_LABEL}</span>
            <span className="tag-row-count">{shortCount}</span>
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
        {hiddenCount > 0 && (
          <li className={`tag-row ${filters.hidden ? 'on' : 'off'}`}>
            <button
              type="button"
              className="tag-row-main"
              aria-pressed={filters.hidden}
              onClick={() => setFilters((f) => ({ ...f, hidden: !f.hidden }))}
            >
              <span className="tag-row-name">Masqués</span>
              <span className="tag-row-count">{hiddenCount}</span>
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
