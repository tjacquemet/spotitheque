import { describe, expect, it } from 'vitest'
import type { Device } from './api'
import { pickDevice } from './devices'

const device = (id: string, type: string, extra: Partial<Device> = {}): Device => ({
  id,
  name: id,
  type,
  isActive: false,
  isRestricted: false,
  ...extra,
})

const phone = device('phone', 'Smartphone')
const mac = device('mac', 'Computer')
const speaker = device('speaker', 'Speaker')

describe('pickDevice', () => {
  it("prend l'appareil demandé explicitement", () => {
    expect(pickDevice([phone, mac], { deviceId: 'mac', clientKind: 'phone' })).toBe(mac)
  })

  it("ne retombe pas sur un autre appareil si celui demandé a disparu", () => {
    expect(pickDevice([phone], { deviceId: 'mac' })).toBeNull()
  })

  it("préfère l'appareil qui joue déjà", () => {
    const playing = { ...speaker, isActive: true }
    expect(pickDevice([phone, mac, playing], { clientKind: 'phone' })).toBe(playing)
  })

  it("sinon choisit un appareil du même type que celui qui affiche l'appli", () => {
    expect(pickDevice([mac, phone], { clientKind: 'phone' })).toBe(phone)
    expect(pickDevice([phone, mac], { clientKind: 'desktop' })).toBe(mac)
  })

  it('prend le seul appareil disponible, sinon rien', () => {
    expect(pickDevice([speaker], { clientKind: 'phone' })).toBe(speaker)
    expect(pickDevice([speaker, device('tv', 'TV')], { clientKind: 'phone' })).toBeNull()
    expect(pickDevice([], { clientKind: 'phone' })).toBeNull()
  })

  it('ignore les appareils non pilotables', () => {
    expect(pickDevice([{ ...phone, isRestricted: true, isActive: true }], { clientKind: 'phone' })).toBeNull()
  })
})
