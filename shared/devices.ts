import type { ClientKind, Device } from './api'

/**
 * Choisit l'appareil Spotify qui doit jouer l'album :
 * l'appareil demandé, sinon celui qui joue déjà, sinon un appareil du même type
 * que celui qui affiche l'appli (téléphone ou ordinateur), sinon le seul disponible.
 */
export function pickDevice(
  devices: Device[],
  opts: { deviceId?: string | null; clientKind?: ClientKind },
): Device | null {
  const usable = devices.filter((d) => d.id && !d.isRestricted)
  if (opts.deviceId) return usable.find((d) => d.id === opts.deviceId) ?? null
  const active = usable.find((d) => d.isActive)
  if (active) return active
  const wanted = opts.clientKind === 'phone' ? 'Smartphone' : 'Computer'
  return usable.find((d) => d.type === wanted) ?? (usable.length === 1 ? usable[0] : null)
}
