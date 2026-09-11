/** Palette des tags, lisible sur fond sombre. */
export const TAG_COLORS = [
  '#f87171',
  '#fb923c',
  '#fbbf24',
  '#d6a57c',
  '#a3e635',
  '#4ade80',
  '#2dd4bf',
  '#22d3ee',
  '#60a5fa',
  '#818cf8',
  '#c084fc',
  '#f472b6',
] as const

export const TAG_NAME_MAX = 40

/** Nom affiché (espaces normalisés) et clé d'unicité insensible à la casse. */
export function normalizeTagName(raw: string): { name: string; key: string } {
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
  return { name, key: name.toLocaleLowerCase('fr-FR') }
}
