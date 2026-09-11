export const nowIso = () => new Date().toISOString()

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

export function setSettingStmt(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
}

export function deleteSettingStmt(db: D1Database, key: string): D1PreparedStatement {
  return db.prepare('DELETE FROM settings WHERE key = ?').bind(key)
}

/** Incrémente la version des données (ETag de GET /api/library) et renvoie la nouvelle valeur. */
export function bumpVersionStmt(db: D1Database): D1PreparedStatement {
  return db.prepare(
    "UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'data_version' RETURNING CAST(value AS INTEGER) AS version",
  )
}

/** Lit la version renvoyée par bumpVersionStmt, placé en dernier dans un batch. */
export function versionFrom(results: D1Result[]): number {
  const last = results[results.length - 1]?.results[0] as { version: number } | undefined
  return last?.version ?? 0
}
