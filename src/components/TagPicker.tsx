import { useState, type KeyboardEvent } from 'react'
import { TAG_NAME_MAX, normalizeTagName } from '../../shared/tags'
import { normalize } from '../lib/text'
import type { Tag } from '../lib/types'
import { createTag } from '../store'
import { toastError } from '../toast'
import { TagChip, type ChipState } from './TagChip'

interface TagPickerProps {
  tags: Tag[]
  stateOf: (tag: Tag) => ChipState
  onToggle: (tag: Tag) => void
  /** Appelé avec le tag fraîchement créé, pour l'appliquer. */
  onCreated: (tag: Tag) => void
  placeholder?: string
}

/** Liste de tous les tags à (dé)cocher, avec recherche et création à la volée. */
export function TagPicker({ tags, stateOf, onToggle, onCreated, placeholder = 'Chercher ou créer un tag…' }: TagPickerProps) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const { name, key } = normalizeTagName(query)
  const q = normalize(name)
  const visible = q ? tags.filter((t) => normalize(t.name).includes(q)) : tags
  const exact = key ? tags.find((t) => t.name.toLocaleLowerCase('fr-FR') === key) : undefined

  const create = async () => {
    if (!name || creating) return
    setCreating(true)
    try {
      onCreated(await createTag(name))
      setQuery('')
    } catch (err) {
      toastError(err)
    } finally {
      setCreating(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (exact) {
      onToggle(exact)
      setQuery('')
    } else if (name) {
      void create()
    }
  }

  return (
    <div className="tag-picker">
      <input
        className="input"
        type="text"
        value={query}
        maxLength={TAG_NAME_MAX}
        placeholder={placeholder}
        enterKeyHint="done"
        autoCapitalize="none"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="chips-wrap">
        {visible
          .filter((tag) => !tag.isGenre)
          .map((tag) => (
            <TagChip key={tag.id} label={tag.name} color={tag.color} state={stateOf(tag)} onClick={() => onToggle(tag)} />
          ))}
        {visible.some((tag) => tag.isGenre) && <span className="chips-label">Genres</span>}
        {visible
          .filter((tag) => tag.isGenre)
          .map((tag) => (
            <TagChip key={tag.id} label={tag.name} color={tag.color} state={stateOf(tag)} onClick={() => onToggle(tag)} />
          ))}
        {name && !exact && (
          <button type="button" className="chip create" onClick={create} disabled={creating}>
            + Créer « {name} »
          </button>
        )}
        {tags.length === 0 && !name && <p className="hint">Aucun tag pour l'instant : tape un nom pour créer le premier.</p>}
      </div>
    </div>
  )
}
