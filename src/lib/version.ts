// Sur téléphone, un onglet reste ouvert des jours : le code qui s'exécute peut être bien plus ancien
// que celui qui est publié. On compare l'empreinte du script courant à celle de la page publiée.

/** Fichier de script courant (assets/index-XXXX.js) : son empreinte identifie la version. */
export const runningVersion = import.meta.url.split('/').pop() ?? 'inconnue'

const SCRIPT = /assets\/index-[\w-]+\.js/

/** Vrai si une version plus récente est en ligne. Faux en cas de doute : jamais d'alerte à tort. */
export async function isOutdated(): Promise<boolean> {
  const res = await fetch('/', { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return false
  const published = (await res.text()).match(SCRIPT)?.[0].split('/').pop()
  // En développement, la page ne référence aucun script empreinté : rien à comparer.
  return published !== undefined && published !== runningVersion
}
