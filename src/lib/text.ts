/** Minuscules sans accents, pour une recherche tolérante (« Bjork » trouve « Björk »). */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })
export const compareText = (a: string, b: string) => collator.compare(a, b)

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
export function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : dateFormat.format(d)
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`
}
