-- Album masqué : il reste dans la bibliothèque Spotify, mais Spotithèque ne l'affiche plus que sous
-- le filtre « Masqués ». La synchro ne touche pas à cette colonne : un album masqué le reste.
ALTER TABLE albums ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
