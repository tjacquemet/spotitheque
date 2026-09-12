-- Version de la recherche ayant produit la fiche. Quand la recherche progresse, les fiches
-- établies par une version antérieure sont refaites : un « introuvable » n'est jamais définitif,
-- il dit seulement que la recherche d'alors n'a rien donné.
ALTER TABLE album_musicbrainz ADD COLUMN lookup_version INTEGER NOT NULL DEFAULT 0;
