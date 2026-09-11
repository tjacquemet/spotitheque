import { useMemo, useState, type FormEvent } from 'react'
import { TAG_COLORS, TAG_NAME_MAX, normalizeTagName } from '../../shared/tags'
import { countTags } from '../lib/filter'
import { plural } from '../lib/text'
import type { Tag } from '../lib/types'
import { createTag, deleteTag, mergeTag, updateTag, useLibrary } from '../store'
import { toast, toastError } from '../toast'
import { BackIcon, ChevronIcon, PlusIcon } from './Icons'
import { Sheet } from './Sheet'

function TagEditSheet({ tag, count, tags, onClose }: { tag: Tag; count: number; tags: Tag[]; onClose: () => void }) {
  const [name, setName] = useState(tag.name)
  const [mergeInto, setMergeInto] = useState('')
  const clean = normalizeTagName(name).name
  const others = tags.filter((t) => t.id !== tag.id)

  const rename = (e: FormEvent) => {
    e.preventDefault()
    if (!clean || clean === tag.name) return
    updateTag(tag.id, { name: clean }).catch(toastError)
    onClose()
  }

  const merge = () => {
    const target = others.find((t) => String(t.id) === mergeInto)
    if (!target) return
    const ok = window.confirm(
      `Les ${plural(count, 'album', 'albums')} de « ${tag.name} » recevront « ${target.name} », puis « ${tag.name} » sera supprimé.`,
    )
    if (!ok) return
    mergeTag(tag.id, target.id).catch(toastError)
    toast(`« ${tag.name} » fusionné dans « ${target.name} »`)
    onClose()
  }

  const remove = () => {
    if (!window.confirm(`Supprimer « ${tag.name} » ? Il sera retiré de ${plural(count, 'album', 'albums')}.`)) return
    deleteTag(tag.id).catch(toastError)
    toast(`« ${tag.name} » supprimé`)
    onClose()
  }

  return (
    <Sheet onClose={onClose} label={`Modifier le tag ${tag.name}`}>
      <h2 className="sheet-title">Modifier le tag</h2>
      <form className="inline-form" onSubmit={rename}>
        <input className="input" value={name} maxLength={TAG_NAME_MAX} onChange={(e) => setName(e.target.value)} aria-label="Nom du tag" />
        <button type="submit" className="btn" disabled={!clean || clean === tag.name}>
          Renommer
        </button>
      </form>

      <h3 className="section-title">Couleur</h3>
      <div className="swatches">
        {TAG_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`swatch${color === tag.color ? ' on' : ''}`}
            style={{ background: color }}
            aria-label={`Couleur ${color}`}
            aria-pressed={color === tag.color}
            onClick={() => updateTag(tag.id, { color }).catch(toastError)}
          />
        ))}
      </div>

      {others.length > 0 && (
        <>
          <h3 className="section-title">Fusionner</h3>
          <div className="inline-form">
            <select className="input" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} aria-label="Tag de destination">
              <option value="">Fusionner dans…</option>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!mergeInto} onClick={merge}>
              Fusionner
            </button>
          </div>
        </>
      )}

      <button type="button" className="btn btn-danger btn-block danger-zone" onClick={remove}>
        Supprimer ce tag
      </button>
    </Sheet>
  )
}

export function TagsScreen({ onBack }: { onBack: () => void }) {
  const data = useLibrary((s) => s.data)
  const [editing, setEditing] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const counts = useMemo(
    () => (data ? countTags(data.albums.filter((a) => a.inLibrary), data.links) : new Map<number, number>()),
    [data],
  )
  const tags = data?.tags ?? []
  const editedTag = editing !== null ? data?.tagsById.get(editing) : undefined

  const create = (e: FormEvent) => {
    e.preventDefault()
    const name = normalizeTagName(newName).name
    if (!name) return
    createTag(name)
      .then(() => setNewName(''))
      .catch(toastError)
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Retour">
            <BackIcon />
          </button>
          <strong className="topbar-title">Tags</strong>
          <span className="spacer" />
          <span className="sync-note">{plural(tags.length, 'tag', 'tags')}</span>
        </div>
      </header>
      <main className="page">
        <form className="inline-form" onSubmit={create}>
          <input
            className="input"
            value={newName}
            maxLength={TAG_NAME_MAX}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nouveau tag"
            aria-label="Nom du nouveau tag"
          />
          <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>
            <PlusIcon size={18} /> Créer
          </button>
        </form>
        {tags.length === 0 ? (
          <p className="empty">Aucun tag. Crée-en un ici ou depuis la fiche d'un album.</p>
        ) : (
          <ul className="list">
            {tags.map((tag) => (
              <li key={tag.id}>
                <button type="button" className="row" onClick={() => setEditing(tag.id)}>
                  <span className="row-dot" style={{ background: tag.color }} />
                  <span className="row-label">{tag.name}</span>
                  <span className="row-count">{plural(counts.get(tag.id) ?? 0, 'album', 'albums')}</span>
                  <ChevronIcon size={16} className="row-chevron" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
      {editedTag && (
        <TagEditSheet
          key={editedTag.id}
          tag={editedTag}
          count={counts.get(editedTag.id) ?? 0}
          tags={tags}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
