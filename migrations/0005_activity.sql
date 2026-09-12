-- Journal des actions réelles (tags posés, analyses, lectures…), pour comprendre après coup
-- ce qui s'est passé. Volontairement borné : les lignes anciennes sont purgées par la tâche quotidienne.
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);

CREATE INDEX idx_activity_at ON activity (at DESC);
