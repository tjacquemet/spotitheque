import { Fragment, type CSSProperties } from 'react'
import type { Tag } from '../lib/types'
import { BanIcon } from './Icons'

interface TagFilterListProps {
  tags: Tag[]
  counts: Map<number, number>
  include: number[]
  exclude: number[]
  onToggle: (id: number) => void
  onToggleExclude: (id: number) => void
}

/** Liste verticale des tags : un par ligne, avec son nombre d'albums et un bouton pour l'exclure. */
export function TagFilterList({ tags, counts, include, exclude, onToggle, onToggleExclude }: TagFilterListProps) {
  // Les tags sont déjà classés genres en dernier : on insère l'intitulé avant le premier d'entre eux.
  const firstGenre = tags.findIndex((t) => t.isGenre)

  return (
    <ul className="tag-list">
      {tags.map((tag, index) => {
        const state = include.includes(tag.id) ? 'on' : exclude.includes(tag.id) ? 'excluded' : 'off'
        const count = counts.get(tag.id) ?? 0
        return (
          <Fragment key={tag.id}>
            {index === firstGenre && (
              <li className="tag-group-label" aria-hidden="true">
                Genres
              </li>
            )}
          <li
            className={`tag-row ${state}${state === 'off' && count === 0 ? ' muted' : ''}`}
            style={{ '--tag': tag.color } as CSSProperties}
          >
            <button type="button" className="tag-row-main" aria-pressed={state === 'on'} onClick={() => onToggle(tag.id)}>
              <span className="row-dot" />
              <span className="tag-row-name">{tag.name}</span>
              {state !== 'excluded' && <span className="tag-row-count">{count}</span>}
            </button>
            <button
              type="button"
              className="tag-row-exclude"
              aria-pressed={state === 'excluded'}
              aria-label={`Exclure ${tag.name}`}
              title={`Exclure les albums avec « ${tag.name} »`}
              onClick={() => onToggleExclude(tag.id)}
            >
              <BanIcon size={15} />
            </button>
          </li>
          </Fragment>
        )
      })}
    </ul>
  )
}
