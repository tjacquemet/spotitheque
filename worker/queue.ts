/**
 * Ce qui a réellement quitté la file de lecture.
 *
 * Compter les titres ne suffit pas : `GET /me/player/queue` ne distingue pas les titres mis en file
 * par l'utilisateur de la suite que Spotify propose tout seul (lecture automatique). Dès que la file
 * se vide, Spotify la regarnit d'une vingtaine de recommandations — une comparaison de longueurs
 * conclurait « rien n'a bougé » alors que tout est parti. On compare donc les URI un à un.
 */
export function removedFromQueue(before: string[], after: string[]): number {
  const left = new Map<string, number>()
  for (const uri of after) left.set(uri, (left.get(uri) ?? 0) + 1)
  let removed = 0
  for (const uri of before) {
    const n = left.get(uri) ?? 0
    if (n > 0) left.set(uri, n - 1)
    else removed++
  }
  return removed
}
