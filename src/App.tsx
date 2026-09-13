import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MeResponse } from '../shared/api'
import { ApiError, api, onApiError } from './api'
import { LibraryScreen } from './components/LibraryScreen'
import { LoginScreen } from './components/LoginScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { SuggestionsScreen } from './components/SuggestionsScreen'
import { TagsScreen } from './components/TagsScreen'
import { Toaster } from './components/Toaster'
import { logAction } from './lib/activity'
import { plural } from './lib/text'
import { isOutdated, runningVersion } from './lib/version'
import { getLibrary, loadLibrary, loadSuggestions, refreshLibrary, resetLibrary, runSync } from './store'
import { toast, toastError } from './toast'

type Screen = 'library' | 'tags' | 'settings' | 'suggestions'

const DAY_MS = 86_400_000
const QUICK_SYNC_EVERY_MS = 10 * 60_000

/** Erreur de connexion transmise par la redirection OAuth (?auth_error=...), retirée de l'URL. */
function takeAuthError(): string | null {
  const error = new URLSearchParams(window.location.search).get('auth_error')
  if (error) window.history.replaceState(null, '', window.location.pathname)
  return error
}

interface MainProps {
  me: MeResponse | null
  setMe: (update: (m: MeResponse | null) => MeResponse | null) => void
  onLogout: () => void
}

function Main({ me, setMe, onLogout }: MainProps) {
  const [screen, setScreen] = useState<Screen>('library')
  const [scopeMissing, setScopeMissing] = useState(false)
  const [outdated, setOutdated] = useState(false)
  const libraryScroll = useRef(0)
  const lastSync = useRef(0)
  const meRef = useRef(me)
  useEffect(() => {
    meRef.current = me
  }, [me])

  /** Synchro en arrière-plan : complète une fois par jour, sinon incrémentale (nouveaux albums seulement). */
  const autoSync = useCallback(async () => {
    const current = meRef.current
    if (current?.spotify !== 'connected') return
    lastSync.current = Date.now()
    const full = !current.lastFullSync || Date.now() - Date.parse(current.lastFullSync) > DAY_MS
    const wasEmpty = (getLibrary()?.albums.length ?? 0) === 0
    try {
      const result = await runSync(full)
      if (result) {
        if (full) setMe((m) => (m ? { ...m, lastFullSync: new Date().toISOString() } : m))
        if (wasEmpty) toast(`Import terminé : ${plural(getLibrary()?.albums.length ?? 0, 'album', 'albums')}`)
        else if (result.added > 0) toast(plural(result.added, 'nouvel album', 'nouveaux albums'))
      }
      // Historique d'écoute : Spotify ne garde que les 50 derniers titres, on relève à chaque ouverture.
      const plays = await api.pollPlays()
      setScopeMissing(plays.scopeMissing)
      if (plays.updated > 0) await refreshLibrary()
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'spotify_reauth')) toastError(err)
    }
  }, [setMe])

  useEffect(() => {
    void loadLibrary().then(autoSync)
    void loadSuggestions().catch(() => undefined)
    logAction('app.ouverte', { version: runningVersion })
  }, [autoSync])

  // Retour au premier plan : données à jour (autre appareil), nouveaux albums Spotify,
  // et vérification de la version — un onglet de téléphone survit à plusieurs déploiements.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void refreshLibrary()
      void isOutdated().then(setOutdated)
      if (Date.now() - lastSync.current > QUICK_SYNC_EVERY_MS) void autoSync()
    }
    void isOutdated().then(setOutdated)
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [autoSync])

  const navigate = (next: Screen) => {
    if (screen === 'library') libraryScroll.current = window.scrollY
    setScreen(next)
  }

  useLayoutEffect(() => {
    window.scrollTo(0, screen === 'library' ? libraryScroll.current : 0)
  }, [screen])

  return (
    <div className="app">
      {outdated && (
        <div className="banner" role="status">
          <span>Une nouvelle version de Spotithèque est en ligne.</span>
          <button type="button" className="banner-action" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </div>
      )}
      {me?.spotify === 'reauth' && (
        <div className="banner" role="status">
          <span>Spotify est déconnecté : lecture et synchro en pause.</span>
          <a href="/api/auth/login">Reconnecter</a>
        </div>
      )}
      {me === null && <div className="banner">Hors connexion : affichage de la dernière version enregistrée.</div>}
      {scopeMissing && me?.spotify === 'connected' && (
        <div className="banner" role="status">
          <span>Pour trier par écoute récente, Spotithèque a besoin d'accéder à ton historique d'écoute.</span>
          <a href="/api/auth/login">Autoriser</a>
        </div>
      )}
      {/* La bibliothèque reste montée pour garder filtres et position en revenant des autres écrans. */}
      <div hidden={screen !== 'library'}>
        <LibraryScreen spotify={me?.spotify ?? null} onNavigate={navigate} />
      </div>
      {screen === 'tags' && <TagsScreen onBack={() => navigate('library')} />}
      {screen === 'suggestions' && <SuggestionsScreen onBack={() => navigate('library')} />}
      {screen === 'settings' && (
        <SettingsScreen
          me={me}
          onBack={() => navigate('library')}
          onSynced={() => setMe((m) => (m ? { ...m, lastFullSync: new Date().toISOString() } : m))}
          onLogout={onLogout}
        />
      )}
    </div>
  )
}

export function App() {
  const [authError] = useState(takeAuthError)
  const [session, setSession] = useState<'checking' | 'anonymous' | 'ready'>('checking')
  const [me, setMe] = useState<MeResponse | null>(null)

  useEffect(() => {
    const unsubscribe = onApiError((err) => {
      if (err.code === 'unauthenticated') setSession('anonymous')
      else if (err.code === 'spotify_reauth') setMe((m) => (m ? { ...m, spotify: 'reauth' } : m))
    })
    api
      .me()
      .then((m) => {
        setMe(m)
        setSession('ready')
      })
      .catch((err) => {
        // Hors connexion : on affiche quand même la bibliothèque en cache.
        if (!(err instanceof ApiError && err.code === 'unauthenticated')) setSession('ready')
      })
    return unsubscribe
  }, [])

  useEffect(() => {
    // Échec d'une reconnexion Spotify alors que la session de l'appli est ouverte.
    if (authError && session === 'ready') toast('La connexion à Spotify a échoué.', { tone: 'error' })
  }, [authError, session])

  const logout = () => {
    void resetLibrary()
    setMe(null)
    setSession('anonymous')
  }

  return (
    <>
      {session === 'checking' && <div className="splash" aria-busy="true" />}
      {session === 'anonymous' && <LoginScreen error={authError} />}
      {session === 'ready' && <Main me={me} setMe={setMe} onLogout={logout} />}
      <Toaster />
    </>
  )
}
