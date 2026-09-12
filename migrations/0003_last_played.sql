-- Date de la dernière écoute, alimentée par l'historique Spotify (50 derniers titres, relevé régulièrement).
ALTER TABLE albums ADD COLUMN last_played_at TEXT;

CREATE INDEX albums_by_last_played ON albums(last_played_at DESC);
