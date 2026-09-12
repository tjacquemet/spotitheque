import { plural } from '../lib/text'
import type { Tag } from '../lib/types'
import { applyTags, useLibrary } from '../store'
import { toast, toastError } from '../toast'
import { Sheet } from './Sheet'
import { TagPicker } from './TagPicker'

interface BulkTagSheetProps {
  albumIds: string[]
  /** Fermeture simple (croix, glissement, fond) : la sélection est conservée. */
  onClose: () => void
  /** « Terminé » : la sélection est vidée pour enchaîner sur d'autres albums. */
  onDone: () => void
}

/** Ajoute ou retire un tag sur tous les albums sélectionnés, avec possibilité d'annuler. */
export function BulkTagSheet({ albumIds, onClose, onDone }: BulkTagSheetProps) {
  const data = useLibrary((s) => s.data)
  if (!data) return null

  const holders = (tag: Tag) => albumIds.filter((id) => data.links.get(id)?.has(tag.id))

  const add = (tag: Tag, lacking: string[]) => {
    applyTags(lacking, [tag.id], []).catch(toastError)
    toast(`« ${tag.name} » ajouté à ${plural(lacking.length, 'album', 'albums')}`, {
      action: { label: 'Annuler', run: () => void applyTags(lacking, [], [tag.id]).catch(toastError) },
    })
  }

  const toggle = (tag: Tag) => {
    const having = holders(tag)
    if (having.length === albumIds.length) {
      applyTags(having, [], [tag.id]).catch(toastError)
      toast(`« ${tag.name} » retiré de ${plural(having.length, 'album', 'albums')}`, {
        action: { label: 'Annuler', run: () => void applyTags(having, [tag.id], []).catch(toastError) },
      })
    } else {
      const set = new Set(having)
      add(tag, albumIds.filter((id) => !set.has(id)))
    }
  }

  return (
    <Sheet onClose={onClose} label="Taguer la sélection">
      <h2 className="sheet-title">Taguer {plural(albumIds.length, 'album', 'albums')}</h2>
      <p className="hint">Toucher un tag l'ajoute à toute la sélection ; s'il est déjà sur tous les albums, il est retiré.</p>
      <TagPicker
        tags={data.tags}
        stateOf={(tag) => {
          const n = holders(tag).length
          return n === albumIds.length ? 'on' : n > 0 ? 'partial' : 'off'
        }}
        onToggle={toggle}
        onCreated={(tag) => add(tag, albumIds)}
        placeholder="Chercher ou créer un tag…"
      />
      <p className="hint legend">
        <span className="legend-dot on" /> sur tous les albums <span className="legend-dot partial" /> sur une partie
      </p>
      <button type="button" className="btn btn-block" onClick={onDone}>
        Terminé
      </button>
    </Sheet>
  )
}
