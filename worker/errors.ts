import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Erreur renvoyée au client sous la forme { error: { code, message } }. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message)

/** Les jetons Spotify manquent ou ont expiré (6 mois) : il faut repasser par la connexion. */
export class SpotifyReauthError extends ApiError {
  constructor() {
    super(403, 'spotify_reauth', 'Reconnecte Spotify pour continuer.')
  }
}
