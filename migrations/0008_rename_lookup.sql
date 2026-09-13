-- La fiche d'un album ne vient plus seulement de MusicBrainz : Wikidata prend le relais quand
-- MusicBrainz refuse. Le nom de la table le dit maintenant.
ALTER TABLE album_musicbrainz RENAME TO album_lookup;
