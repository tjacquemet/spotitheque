import { useRef, useState, type ChangeEvent } from 'react'
import type { MeResponse } from '../../shared/api'
import { api } from '../api'
import { formatDate, plural } from '../lib/text'
import { importBackup, runSync, useLibrary } from '../store'
import { toast, toastError } from '../toast'
import { BackIcon, SyncIcon } from './Icons'

interface Props {
  me: MeResponse | null
  onBack: () => void
  onSynced: () => void
  onLogout: () => void
}

/** Télécharge la sauvegarde ; sur iPhone, la feuille de partage permet de l'enregistrer dans Fichiers. */
async function exportTags() {
  const res = await fetch('/api/export', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Export impossible (${res.status}).`)
  const blob = await res.blob()
  const name = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'spotitheque-tags.json'
  const file = new File([blob], name, { type: 'application/json' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function SettingsScreen({ me, onBack, onSynced, onLogout }: Props) {
  const data = useLibrary((s) => s.data)
  const sync = useLibrary((s) => s.sync)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const inLibrary = data?.albums.filter((a) => a.inLibrary).length ?? 0
  const lastFull = formatDate(me?.lastFullSync ?? null)
  const connected = me?.spotify === 'connected'

  const doSync = async (full: boolean) => {
    try {
      const r = await runSync(full)
      if (!r) return
      const parts = [r.added ? plural(r.added, 'nouvel album', 'nouveaux albums') : null, r.removed ? plural(r.removed, 'album retiré', 'albums retirés') : null]
      toast(parts.filter(Boolean).join(', ') || 'Bibliothèque à jour')
      if (full) onSynced()
    } catch (err) {
      toastError(err)
    }
  }

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const r = await importBackup(JSON.parse(await file.text()))
      toast(`Import terminé : ${plural(r.links, 'tag posé', 'tags posés')}, ${plural(r.tags, 'tag créé', 'tags créés')}.`)
    } catch (err) {
      toastError(err instanceof SyntaxError ? new Error("Ce fichier n'est pas un JSON valide.") : err)
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    if (!window.confirm('Se déconnecter de Spotithèque sur cet appareil ?')) return
    await api.logout().catch(() => undefined)
    onLogout()
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Retour">
            <BackIcon />
          </button>
          <strong className="topbar-title">Réglages</strong>
        </div>
      </header>
      <main className="page">
        <section className="panel">
          <h2 className="panel-title">Spotify</h2>
          {connected ? (
            <p>Connecté au compte <strong>{me?.displayName}</strong>.</p>
          ) : me?.spotify === 'reauth' ? (
            <p className="warn">L'autorisation Spotify a expiré (Spotify la limite à 6 mois) : reconnecte-toi pour la lecture et la synchro.</p>
          ) : (
            <p>Spotify n'est pas connecté.</p>
          )}
          <a className={`btn ${connected ? '' : 'btn-primary'}`} href="/api/auth/login">
            {connected ? 'Renouveler l’autorisation' : 'Connecter Spotify'}
          </a>
        </section>

        <section className="panel">
          <h2 className="panel-title">Bibliothèque</h2>
          <p>
            {plural(inLibrary, 'album', 'albums')} · {plural(data?.tags.length ?? 0, 'tag', 'tags')}
            {lastFull && <span className="muted"> · dernière synchro complète le {lastFull}</span>}
          </p>
          {sync && (
            <div className="progress" aria-hidden="true">
              <div style={{ width: sync.total ? `${(100 * sync.done) / sync.total}%` : '4%' }} />
            </div>
          )}
          <div className="button-row">
            <button type="button" className="btn" disabled={!connected || Boolean(sync)} onClick={() => void doSync(false)}>
              <SyncIcon size={18} /> Synchroniser
            </button>
            <button type="button" className="btn" disabled={!connected || Boolean(sync)} onClick={() => void doSync(true)}>
              Tout resynchroniser
            </button>
          </div>
          <p className="hint">« Tout resynchroniser » parcourt toute ta bibliothèque et repère aussi les albums retirés.</p>
        </section>

        <section className="panel">
          <h2 className="panel-title">Sauvegarde</h2>
          <p className="hint">Tes tags et les albums tagués, dans un fichier JSON à garder de côté. L'import ajoute sans rien supprimer.</p>
          <div className="button-row">
            <button type="button" className="btn" onClick={() => exportTags().catch(toastError)}>
              Exporter les tags
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? 'Import…' : 'Importer une sauvegarde'}
            </button>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onImport} />
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">Session</h2>
          <button type="button" className="btn btn-danger" onClick={() => void logout()}>
            Se déconnecter de cet appareil
          </button>
        </section>
      </main>
    </>
  )
}
