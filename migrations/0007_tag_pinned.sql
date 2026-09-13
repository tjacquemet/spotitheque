-- Tag épinglé : regroupé au début des listes, avant les tags ordinaires et les genres.
-- Même mécanisme que is_genre, à l'autre bout de la liste.
ALTER TABLE tags ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
