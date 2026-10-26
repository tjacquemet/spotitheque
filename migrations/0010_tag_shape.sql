-- Forme de la pastille d'un tag dans la grille d'albums : une couleur seule ne suffit pas à repérer
-- un tag parmi vingt-cinq quand on parcourt la grille. Même mécanisme que is_genre et is_pinned,
-- mais pour l'œil : 'dot' (défaut), 'star', 'diamond'.
ALTER TABLE tags ADD COLUMN shape TEXT NOT NULL DEFAULT 'dot';
