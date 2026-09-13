import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOutdated } from './version'

// En test, le module n'est pas empreinté : `runningVersion` vaut « version.ts ».
const page = (body: string) => new Response(body, { status: 200 })

describe('isOutdated', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('repère un script publié différent de celui qui tourne', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(page('<script src="/assets/index-kZPcDk35.js"></script>'))))
    await expect(isOutdated()).resolves.toBe(true)
  })

  it("ne signale rien quand la page ne référence aucun script empreinté (développement)", async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(page('<script type="module" src="/src/main.tsx"></script>'))))
    await expect(isOutdated()).resolves.toBe(false)
  })

  it('ne signale rien quand la page est injoignable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('hors ligne'))))
    await expect(isOutdated()).resolves.toBe(false)
  })
})
