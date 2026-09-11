-- Albums sauvegardés dans la bibliothèque Spotify. Jamais supprimés :
-- un album retiré de Spotify passe à in_library = 0 et garde ses tags.
CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artists TEXT NOT NULL,           -- JSON : [{"id": "...", "name": "..."}]
  image_url TEXT,                  -- pochette ~300 px (grille)
  image_url_large TEXT,            -- pochette ~640 px (fiche)
  release_date TEXT,
  total_tracks INTEGER,
  upc TEXT,                        -- code-barres, pour MusicBrainz (V1.1)
  added_at TEXT,                   -- date d'ajout à la bibliothèque Spotify
  in_library INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,   -- nom normalisé (minuscules) pour l'unicité
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE album_tags (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (album_id, tag_id)
);

CREATE INDEX album_tags_by_tag ON album_tags(tag_id);

-- Sessions de l'appli : seul le hash SHA-256 du jeton est stocké.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_agent TEXT
);

-- Réglages clé/valeur : propriétaire, jetons Spotify, version des données...
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('data_version', '1');
