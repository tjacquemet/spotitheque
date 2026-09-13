import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// La politique de sécurité de l'appli décide des domaines que le navigateur accepte d'appeler.
// Un domaine oublié dans `connect-src` et la requête ne part jamais, sans erreur visible : le
// 2026-09-13, toutes les recherches dans les bases musicales ont ainsi échoué pendant deux jours.
// Ce test relie les deux : tout domaine écrit dans src/lib, d'où partent les appels sortants,
// doit être autorisé — ou déclaré ici comme simple lien, ouvert par l'utilisateur et non par fetch.

const LIB = join(import.meta.dirname, '.')
/** Domaines qu'on ouvre dans un onglet sans jamais les appeler : ils n'ont rien à faire dans connect-src. */
const NAVIGATION_ONLY = ['https://open.spotify.com']

function hostsUsedInLib(): string[] {
  const files = readdirSync(LIB).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  const found = new Set<string>()
  for (const file of files) {
    for (const [url] of readFileSync(join(LIB, file), 'utf8').matchAll(/https:\/\/[a-z0-9.-]+/g)) {
      if (!NAVIGATION_ONLY.includes(url)) found.add(url)
    }
  }
  return [...found]
}

function connectSrc(): string[] {
  const headers = readFileSync(join(import.meta.dirname, '../../public/_headers'), 'utf8')
  return (headers.match(/connect-src ([^;]+);/)?.[1] ?? '').trim().split(/\s+/)
}

describe('Content-Security-Policy', () => {
  it('autorise tous les domaines appelés depuis le navigateur', () => {
    const allowed = connectSrc()
    expect(allowed).toContain("'self'")
    for (const host of hostsUsedInLib()) {
      expect(allowed, `${host} doit figurer dans connect-src de public/_headers`).toContain(host)
    }
  })

  it('trouve bien les domaines à vérifier (le test ne doit pas passer à vide)', () => {
    expect(hostsUsedInLib().length).toBeGreaterThanOrEqual(3)
  })
})
