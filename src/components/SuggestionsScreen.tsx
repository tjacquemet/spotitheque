import { useEffect, useMemo } from 'react'
import { plural } from '../lib/text'
import { acceptSuggestion, loadSuggestions, rejectSuggestion, useLibrary } from '../store'
import { toastError } from '../toast'
import { AlbumCover } from './AlbumCover'
import { BackIcon, CheckIcon, CloseIcon, SparkleIcon } from './Icons'

export function SuggestionsScreen({ onBack }: { onBack: () => void }) {
  const data = useLibrary((s) => s.data)
  const suggestions = useLibrary((s) => s.suggestions)
  const run = useLibrary((s) => s.suggestRun)

  useEffect(() => {
    loadSuggestions().catch(toastError)
  }, [])

  const albums = useMemo(
    () =>
      [...suggestions.entries()]
        .map(([albumId, list]) => ({ album: data?.albumsById.get(albumId), list, albumId }))
        .filter((entry) => entry.album),
    [suggestions, data],
  )

  const total = [...suggestions.values()].reduce((n, list) => n + list.length, 0)

  const acceptAll = (albumId: string, labels: string[]) => {
    for (const label of labels) acceptSuggestion(albumId, label).catch(toastError)
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Retour">
            <BackIcon />
          </button>
          <strong className="topbar-title">Suggestions</strong>
          <span className="spacer" />
          <span className="sync-note">{total > 0 ? plural(total, 'proposition', 'propositions') : ''}</span>
        </div>
      </header>

      <main className="page">
        {run && (
          <p className="hint">
            Analyse en cours : {run.done} / {run.total} albums.
          </p>
        )}

        {albums.length === 0 ? (
          <div className="empty">
            <SparkleIcon size={32} />
            <p>Aucune proposition en attente.</p>
            <p className="hint">
              Dans la bibliothèque, filtre les albums à examiner — par exemple « Téléchargé » puis « Sans autre tag » — et
              touche l'étoile dans la barre d'outils.
            </p>
          </div>
        ) : (
          <ul className="suggestion-list">
            {albums.map(({ album, list, albumId }) => (
              <li key={albumId} className="suggestion-card">
                <div className="suggestion-head">
                  <div className="cover suggestion-cover">
                    <AlbumCover album={album!} />
                  </div>
                  <div className="suggestion-meta">
                    <strong>{album!.name}</strong>
                    <span>{album!.artistNames}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Ignorer les propositions pour ${album!.name}`}
                    title="Ignorer"
                    onClick={() => rejectSuggestion(albumId).catch(toastError)}
                  >
                    <CloseIcon size={18} />
                  </button>
                </div>
                <div className="chips-wrap">
                  {list.map((suggestion) => {
                    const tag = suggestion.tagId ? data?.tagsById.get(suggestion.tagId) : undefined
                    return (
                      <button
                        key={suggestion.label}
                        type="button"
                        className={`chip suggestion${tag ? '' : ' create'}`}
                        style={tag ? ({ '--tag': tag.color } as React.CSSProperties) : undefined}
                        title={suggestion.source === 'artist' ? 'Posé sur un autre album du même artiste' : 'Proposé par l’analyse'}
                        onClick={() => acceptSuggestion(albumId, suggestion.label).catch(toastError)}
                      >
                        {tag && <span className="dot" />}
                        <span className="chip-label">
                          {tag ? suggestion.label : `Nouveau : ${suggestion.label}`}
                        </span>
                        <CheckIcon size={14} strokeWidth={3} />
                      </button>
                    )
                  })}
                  {list.length > 1 && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => acceptAll(albumId, list.map((s) => s.label))}
                    >
                      Tout accepter
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
