// Génère des données fictives pour tester l'interface en local, sans compte Spotify :
//   npm run db:migrate && npm run db:seed
// Les pochettes viennent de picsum.photos (images aléatoires), une sur dix est absente pour tester le repli.

let seed = 20260911
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32
  return seed / 2 ** 32
}
const pick = (list) => list[Math.floor(rand() * list.length)]
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const spotifyId = () => Array.from({ length: 22 }, () => pick(BASE62)).join('')
const sql = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

const firstWords = ['Blue', 'Nuits', 'Golden', 'Les Heures', 'Midnight', 'Échos', 'Silver', 'Paper', 'Velvet', 'Lumière', 'Northern', 'Petit', 'Electric', 'Quiet', 'Solstice', 'Neon', 'Jardin', 'Ocean', 'Brume', 'Marée']
const secondWords = ['Horizons', 'Claires', 'Roads', 'Sessions', 'Garden', 'Machines', 'd’été', 'Hearts', 'Motel', 'Lines', 'Club', 'Memories', 'Tapes', 'du Nord', 'Stories', 'Dreams', 'Rivers', 'Suite', 'Parade', 'Fever']
const artists = ['Marie Lune', 'The Velvet Owls', 'Oscar Delta', 'Nina Sol', 'Les Cerfs-Volants', 'Kōji Aoki', 'Blue Harbour', 'Élodie Rivière', 'Mothwing', 'DJ Pastèque', 'Arno Vidal', 'Sunday Trio', 'Björn Ek', 'La Fanfare Céleste', 'Night Drive', 'Ada Quartet', 'Tomás Ríos', 'Orchestre de Chambre de Lyon', 'Lo-Fi Cats', 'Inès Moreau']
const tags = [
  ['jazz', '#60a5fa'],
  ['calme', '#2dd4bf'],
  ['rock', '#f87171'],
  ['électro', '#c084fc'],
  ['dimanche matin', '#fbbf24'],
  ['à découvrir', '#a3e635'],
  ['soirée', '#f472b6'],
  ['running', '#fb923c'],
  ['classique', '#818cf8'],
  ['hip-hop', '#d6a57c'],
]

const lines = ['DELETE FROM album_tags;', 'DELETE FROM tags;', 'DELETE FROM albums;']
tags.forEach(([name, color], i) => {
  lines.push(`INSERT INTO tags (id, name, name_key, color) VALUES (${i + 1}, ${sql(name)}, ${sql(name.toLowerCase())}, ${sql(color)});`)
})

const now = new Date('2026-09-11T12:00:00Z').getTime()
for (let i = 0; i < 360; i++) {
  const id = spotifyId()
  const artistCount = rand() < 0.12 ? 2 : 1
  const albumArtists = Array.from({ length: artistCount }, () => ({ id: spotifyId(), name: pick(artists) }))
  const year = 1955 + Math.floor(rand() * 71)
  const hasImage = rand() > 0.1
  const image = hasImage ? `https://picsum.photos/seed/${id}/300` : null
  const imageLarge = hasImage ? `https://picsum.photos/seed/${id}/640` : null
  const addedAt = new Date(now - Math.floor(rand() * 4 * 365) * 86_400_000).toISOString().replace('.000', '')
  const inLibrary = rand() < 0.03 ? 0 : 1
  lines.push(
    `INSERT INTO albums (id, name, artists, image_url, image_url_large, release_date, total_tracks, upc, added_at, in_library, synced_at) VALUES (${[
      id,
      `${pick(firstWords)} ${pick(secondWords)}`,
      JSON.stringify(albumArtists),
      image,
      imageLarge,
      `${year}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`,
      6 + Math.floor(rand() * 12),
      null,
      addedAt,
      inLibrary,
      addedAt,
    ]
      .map(sql)
      .join(', ')});`,
  )
  // Environ 60 % des albums sont déjà tagués, avec 1 à 3 tags.
  if (rand() < 0.6) {
    const count = 1 + Math.floor(rand() * 3)
    const chosen = new Set(Array.from({ length: count }, () => 1 + Math.floor(rand() * tags.length)))
    for (const tagId of chosen) lines.push(`INSERT INTO album_tags (album_id, tag_id) VALUES (${sql(id)}, ${tagId});`)
  }
}
lines.push("UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'data_version';")
console.log(lines.join('\n'))
