import type { Tag } from './types'

/** Les trois groupes de tags, dans leur ordre d'affichage. */
export const tagGroup = (t: Tag) => (t.isPinned ? 0 : t.isGenre ? 2 : 1)

const LABELS = ['Épinglés', 'Autres', 'Genres']

/**
 * Intitulé à insérer avant ce tag lorsqu'il ouvre un groupe, sinon null.
 * Les tags ordinaires n'en reçoivent un que s'ils succèdent aux épinglés : seuls, ils ouvrent la liste.
 */
export function tagGroupLabel(tags: Tag[], index: number): string | null {
  const group = tagGroup(tags[index])
  if (index === 0) return group === 1 ? null : LABELS[group]
  return tagGroup(tags[index - 1]) === group ? null : LABELS[group]
}
