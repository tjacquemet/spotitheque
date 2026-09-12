-- Un tag peut être marqué « genre musical » : ces tags sont regroupés en fin de liste.
ALTER TABLE tags ADD COLUMN is_genre INTEGER NOT NULL DEFAULT 0;
