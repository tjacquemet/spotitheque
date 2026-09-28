import { Fragment, useEffect, useMemo, useRef } from 'react'
import { SHORT_LABEL } from '../lib/filter'
import { tagGroupLabel } from '../lib/groups'
import type { Filters, Tag } from '../lib/types'
import { TagIcon } from './Icons'
import { TagChip, type ChipState } from './TagChip'

interface TagBarProps {
  tags: Tag[]
  counts: Map<number, number>
  filters: Filters
  /** « Sans tag » ou « Sans autre tag » selon qu'un tag est déjà sélectionné. */
  untaggedLabel: string
  untaggedCount: number
  /** Albums courts parmi ceux qu'affichent les filtres actuels. */
  shortCount: number
  removedCount: number
  hiddenCount: number
  onToggle: (id: number) => void
  onToggleExclude: (id: number) => void
  setFilters: (update: (f: Filters) => Filters) => void
  onOpenPanel: () => void
}

/**
 * Barre horizontale de tags, sous la recherche : la façon de filtrer sur téléphone.
 * Les tags actifs passent en tête pour rester visibles ; les autres gardent leurs groupes.
 */
export function TagBar({
  tags,
  counts,
  filters,
  untaggedLabel,
  untaggedCount,
  shortCount,
  removedCount,
  hiddenCount,
  onToggle,
  onToggleExclude,
  setFilters,
  onOpenPanel,
}: TagBarProps) {
  const { activeTags, otherTags } = useMemo(() => {
    const byId = new Map(tags.map((t) => [t.id, t]))
    const ids = [...filters.include, ...filters.exclude]
    return {
      activeTags: ids.map((id) => byId.get(id)).filter((t): t is Tag => t !== undefined),
      otherTags: tags.filter((t) => !ids.includes(t.id)),
    }
  }, [tags, filters.include, filters.exclude])

  // La barre revient à son début quand la sélection change : les tags actifs restent sous les yeux.
  const bar = useRef<HTMLDivElement>(null)
  const activeKey = `${filters.include.join()}|${filters.exclude.join()}`
  useEffect(() => {
    bar.current?.scrollTo({ left: 0, behavior: 'smooth' })
  }, [activeKey])

  const state = (id: number): ChipState =>
    filters.include.includes(id) ? 'on' : filters.exclude.includes(id) ? 'excluded' : 'off'

  const renderTag = (tag: Tag) => {
    const chipState = state(tag.id)
    const count = counts.get(tag.id) ?? 0
    return (
      <TagChip
        key={tag.id}
        label={tag.name}
        color={tag.color}
        state={chipState}
        count={chipState === 'excluded' ? undefined : count}
        muted={chipState === 'off' && count === 0}
        onClick={() => onToggle(tag.id)}
        onLongPress={() => onToggleExclude(tag.id)}
        title="Toucher pour filtrer, appui long pour exclure"
      />
    )
  }

  const activeCount = filters.include.length + filters.exclude.length

  return (
    <div className="tagbar-row">
      <button type="button" className="chip tagbar-open" onClick={onOpenPanel}>
        <TagIcon size={15} /> Tags
        {activeCount > 0 && <span className="chip-badge">{activeCount}</span>}
      </button>
      <div className="tagbar" role="toolbar" aria-label="Filtrer par tags" ref={bar}>
        {activeTags.map(renderTag)}
        {activeTags.length > 0 && <span className="tagbar-sep" />}
        <TagChip
          label={untaggedLabel}
          count={untaggedCount}
          state={filters.untagged ? 'on' : 'off'}
          onClick={() => setFilters((f) => ({ ...f, untagged: !f.untagged }))}
        />
        <TagChip
          label={SHORT_LABEL}
          count={shortCount}
          state={filters.short ? 'on' : 'off'}
          onClick={() => setFilters((f) => ({ ...f, short: !f.short }))}
        />
        {removedCount > 0 && (
          <TagChip
            label="Retirés de Spotify"
            count={removedCount}
            state={filters.removed ? 'on' : 'off'}
            onClick={() => setFilters((f) => ({ ...f, removed: !f.removed }))}
          />
        )}
        {hiddenCount > 0 && (
          <TagChip
            label="Masqués"
            count={hiddenCount}
            state={filters.hidden ? 'on' : 'off'}
            onClick={() => setFilters((f) => ({ ...f, hidden: !f.hidden }))}
          />
        )}
        {otherTags.length > 0 && <span className="tagbar-sep" />}
        {/* Mêmes groupes que dans les listes : épinglés, ordinaires, genres. */}
        {otherTags.map((tag, index) => {
          const group = tagGroupLabel(otherTags, index)
          return (
            <Fragment key={tag.id}>
              {group && <span className="tagbar-label">{group}</span>}
              {renderTag(tag)}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
