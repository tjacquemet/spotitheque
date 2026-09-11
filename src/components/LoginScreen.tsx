import { DiscIcon } from './Icons'

const ERRORS: Record<string, string> = {
  denied: 'Connexion annulée.',
  state: 'La connexion a expiré : réessaie.',
  not_owner: "Ce compte Spotify n'est pas celui du propriétaire de Spotithèque.",
  token: "Spotify n'a pas pu valider la connexion : réessaie.",
  profile: "Impossible de lire ton profil Spotify : réessaie.",
  config: 'Identifiants Spotify absents de la configuration du serveur (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET).',
}

export function LoginScreen({ error }: { error: string | null }) {
  return (
    <main className="login">
      <div className="login-card">
        <div className="logo">
          <DiscIcon size={44} />
        </div>
        <h1>Spotithèque</h1>
        <p className="muted">Tes albums Spotify, rangés par tags.</p>
        {error && <p className="warn">{ERRORS[error] ?? 'La connexion a échoué.'}</p>}
        <a className="btn btn-primary btn-lg" href="/api/auth/login">
          Se connecter avec Spotify
        </a>
        {import.meta.env.DEV && (
          <a className="link-subtle" href="/api/auth/dev-login">
            Connexion de développement (sans Spotify)
          </a>
        )}
      </div>
    </main>
  )
}
