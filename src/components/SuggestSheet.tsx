import { plural } from '../lib/text'
import { SparkleIcon } from './Icons'
import { Sheet } from './Sheet'

interface SuggestSheetProps {
  /** « 21 albums affichés » ou « 3 albums sélectionnés » : ce que l'analyse va traiter. */
  analysisLabel: string
  pendingSuggestions: number
  progress: { done: number; total: number } | null
  onAnalyze: () => void
  onSeeSuggestions: () => void
  onClose: () => void
}

export function SuggestSheet({
  analysisLabel,
  pendingSuggestions,
  progress,
  onAnalyze,
  onSeeSuggestions,
  onClose,
}: SuggestSheetProps) {
  return (
    <Sheet onClose={onClose} label="Suggestions de tags">
      <h2 className="sheet-title">Suggestions de tags</h2>
      <p className="hint">
        Chaque album est retrouvé dans MusicBrainz ou Wikidata, les encyclopédies musicales libres, et c'est sa fiche —
        jamais les données Spotify — qui est analysée avec la liste de tes tags. Tu valides ensuite chaque proposition.
      </p>
      {progress ? (
        <>
          <div className="progress" aria-hidden="true">
            <div style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
          </div>
          <p className="hint">
            Analyse en cours : {progress.done} / {progress.total} albums. Tu peux fermer cette fenêtre, ça continue.
          </p>
        </>
      ) : (
        <button type="button" className="btn btn-primary btn-block" onClick={onAnalyze}>
          <SparkleIcon /> Analyser {analysisLabel}
        </button>
      )}
      {pendingSuggestions > 0 && (
        <button type="button" className="btn btn-block" onClick={onSeeSuggestions}>
          Voir {plural(pendingSuggestions, 'proposition', 'propositions')}
        </button>
      )}
    </Sheet>
  )
}
