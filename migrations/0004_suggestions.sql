-- Fiche MusicBrainz d'un album : c'est elle, et jamais les données Spotify,
-- qui est transmise au modèle d'IA qui propose des tags.
CREATE TABLE album_musicbrainz (
  album_id TEXT PRIMARY KEY REFERENCES albums(id) ON DELETE CASCADE,
  mbid TEXT,
  title TEXT,
  artist TEXT,
  year INTEGER,
  genres TEXT,                       -- JSON : ["techno", "ambient", ...]
  status TEXT NOT NULL,              -- found | missing
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Tags proposés, en attente de validation. Un refus est conservé pour ne plus reproposer.
CREATE TABLE suggestions (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  label TEXT NOT NULL,               -- nom proposé (tag existant ou nouveau)
  label_key TEXT NOT NULL,           -- nom normalisé
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL,              -- ai | artist
  score REAL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | rejected
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (album_id, label_key)
);

CREATE INDEX suggestions_by_status ON suggestions(status);
