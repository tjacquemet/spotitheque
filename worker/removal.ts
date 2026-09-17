/** Issue d'une vérification : l'album a quitté la bibliothèque, y est encore, ou impossible de le savoir. */
export type RemovalCheck = 'removed' | 'still-saved' | 'unknown'

/**
 * Confirme qu'un retrait a pris effet. Spotify répond 200 à une demande de retrait même quand rien
 * n'a changé : seule une relecture fait foi. Quelques essais espacés laissent au retrait le temps de
 * se propager avant de conclure qu'il n'a pas eu lieu.
 *
 * `check` renvoie true si l'album est encore sauvegardé, false s'il ne l'est plus, null si la
 * vérification elle-même a échoué.
 */
export async function confirmRemoval(check: () => Promise<boolean | null>, attempts = 3, delayMs = 800): Promise<RemovalCheck> {
  let answered = false
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const saved = await check()
    if (saved === false) return 'removed'
    if (saved === true) answered = true
  }
  return answered ? 'still-saved' : 'unknown'
}
