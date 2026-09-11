import { useState, type CSSProperties } from 'react'
import type { Album } from '../lib/types'

function hue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

/** Pochette de l'album, ou un dégradé avec l'initiale si Spotify n'en fournit pas. */
export function AlbumCover({ album, large = false }: { album: Album; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  const src = large ? (album.imageLarge ?? album.image) : album.image
  if (src && !failed) {
    return <img src={src} alt="" loading={large ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} />
  }
  const h = hue(album.id)
  const style = { '--c1': `hsl(${h} 45% 34%)`, '--c2': `hsl(${(h + 50) % 360} 55% 20%)` } as CSSProperties
  return (
    <div className="placeholder" style={style} aria-hidden="true">
      {album.name.trim().charAt(0).toUpperCase() || '♪'}
    </div>
  )
}
