import { plural } from '../lib/text'
import type { Filters, SortKey } from '../lib/types'
import { DiceIcon, DicePlayIcon, SparkleIcon } from './Icons'

/** Libellés du menu de tri, dans l'ordre d'affichage. */
export const SORTS: Record<SortKey, string> = {
  played: 'Écoute',
  added: 'Ajout',
  artist: 'Artiste',
  title: 'Titre',
  year: 'Année',
  random: 'Aléatoire',
}

interface LibraryToolbarProps {
  resultCount: number
  filters: Filters
  /** Un filtre est actif : le bouton « Effacer » a un sens. */
  active: boolean
  sort: SortKey
  pendingSuggestions: number
  /** Un album au hasard part dans la file : le bouton attend la réponse de Spotify. */
  launching: boolean
  setFilters: (update: (f: Filters) => Filters) => void
  onClearFilters: () => void
  onSort: (value: SortKey) => void
  onOpenSuggest: () => void
  onSurprise: () => void
  onPlayRandom: () => void
}

/**
 * Ligne au-dessus de la grille : nombre de résultats, combinaison des tags, tri, suggestions.
 * Deux dés ferment la marche : l'un ouvre un album au hasard, l'autre le lance sans rien demander.
 */
export function LibraryToolbar({
  resultCount,
  filters,
  active,
  sort,
  pendingSuggestions,
  launching,
  setFilters,
  onClearFilters,
  onSort,
  onOpenSuggest,
  onSurprise,
  onPlayRandom,
}: LibraryToolbarProps) {
  return (
    <div className="toolbar">
      <span className="result-count">{plural(resultCount, 'album', 'albums')}</span>
      {filters.include.length >= 2 && (
        <div className="segmented" role="group" aria-label="Combinaison des tags">
          <button
            type="button"
            className={filters.mode === 'and' ? 'active' : ''}
            onClick={() => setFilters((f) => ({ ...f, mode: 'and' }))}
            title="Tous les tags"
          >
            ET
          </button>
          <button
            type="button"
            className={filters.mode === 'or' ? 'active' : ''}
            onClick={() => setFilters((f) => ({ ...f, mode: 'or' }))}
            title="Au moins un tag"
          >
            OU
          </button>
        </div>
      )}
      {active && (
        <button type="button" className="link-btn" onClick={onClearFilters}>
          Effacer
        </button>
      )}
      <span className="spacer" />
      <select className="select" value={sort} onChange={(e) => onSort(e.target.value as SortKey)} aria-label="Trier par">
        {Object.entries(SORTS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="icon-btn suggest-btn"
        onClick={onOpenSuggest}
        aria-label="Suggestions de tags"
        title="Suggestions de tags"
      >
        <SparkleIcon />
        {pendingSuggestions > 0 && <span className="badge">{pendingSuggestions}</span>}
      </button>
      <button type="button" className="icon-btn accent" onClick={onSurprise} aria-label="Surprends-moi" title="Surprends-moi">
        <DiceIcon />
      </button>
      <button
        type="button"
        className="icon-btn accent"
        onClick={onPlayRandom}
        disabled={launching}
        aria-label="Lancer un album au hasard"
        title="Lancer un album au hasard"
      >
        <DicePlayIcon />
      </button>
    </div>
  )
}
