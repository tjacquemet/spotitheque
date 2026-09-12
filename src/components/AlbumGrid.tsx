import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useBandSelect } from '../hooks/useBandSelect'
import { useLongPress } from '../hooks/useLongPress'
import type { Album, Tag } from '../lib/types'
import { AlbumCover } from './AlbumCover'
import { CheckIcon } from './Icons'

const PAGE_SIZE = 120
const MAX_DOTS = 5
const NO_TAGS: Tag[] = []

interface CardProps {
  album: Album
  tags: Tag[]
  selecting: boolean
  selected: boolean
  onOpen: (id: string) => void
  onSelect: (id: string) => void
}

const AlbumCard = memo(function AlbumCard({ album, tags, selecting, selected, onOpen, onSelect }: CardProps) {
  const press = useLongPress(
    () => onSelect(album.id),
    () => (selecting ? onSelect(album.id) : onOpen(album.id)),
  )
  return (
    <button
      type="button"
      data-album={album.id}
      className={`card${selected ? ' selected' : ''}${album.inLibrary ? '' : ' removed'}`}
      aria-pressed={selecting ? selected : undefined}
      aria-label={`${album.name}, ${album.artistNames}`}
      {...press}
    >
      <div className="cover">
        <AlbumCover album={album} />
        {selecting && (
          <span className="check" aria-hidden="true">
            {selected && <CheckIcon size={14} strokeWidth={3} />}
          </span>
        )}
      </div>
      <div className="card-title">{album.name}</div>
      <div className="card-artist">{album.artistNames}</div>
      <div className="dots" aria-hidden="true">
        {tags.slice(0, MAX_DOTS).map((t) => (
          <span key={t.id} style={{ background: t.color }} />
        ))}
        {tags.length > MAX_DOTS && <em>+{tags.length - MAX_DOTS}</em>}
      </div>
    </button>
  )
})

interface GridProps {
  albums: Album[]
  links: Map<string, Set<number>>
  tagsById: Map<number, Tag>
  selection: Set<string> | null
  onOpen: (id: string) => void
  onSelect: (id: string) => void
  /** Sélection par rectangle à la souris. */
  onSelectionChange: (next: Set<string>) => void
}

/** Grille de pochettes, rendue par tranches au fil du défilement. */
export function AlbumGrid({ albums, links, tagsById, selection, onOpen, onSelect, onSelectionChange }: GridProps) {
  const [limit, setLimit] = useState(PAGE_SIZE)
  const sentinel = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const { rect, handlers } = useBandSelect(grid, selection, onSelectionChange)

  // Seuls les albums modifiés reçoivent un nouveau Set de tags : les autres cartes ne se re-rendent pas.
  const tagCache = useMemo(() => new WeakMap<Set<number>, Tag[]>(), [tagsById])
  const tagsFor = (ids: Set<number> | undefined): Tag[] => {
    if (!ids) return NO_TAGS
    let tags = tagCache.get(ids)
    if (!tags) {
      tags = [...ids].map((id) => tagsById.get(id)).filter((t): t is Tag => Boolean(t))
      tagCache.set(ids, tags)
    }
    return tags
  }

  useEffect(() => setLimit(PAGE_SIZE), [albums])

  useEffect(() => {
    const el = sentinel.current
    if (!el || limit >= albums.length) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setLimit((l) => l + PAGE_SIZE)
      },
      { rootMargin: '1200px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [limit, albums.length])

  return (
    <>
      <div className={`grid${rect ? ' banding' : ''}`} ref={grid} {...handlers}>
        {rect && <div className="band" style={rect} aria-hidden="true" />}
        {albums.slice(0, limit).map((album) => {
          return (
            <AlbumCard
              key={album.id}
              album={album}
              tags={tagsFor(links.get(album.id))}
              selecting={selection !== null}
              selected={selection?.has(album.id) ?? false}
              onOpen={onOpen}
              onSelect={onSelect}
            />
          )
        })}
      </div>
      {limit < albums.length && <div ref={sentinel} className="grid-sentinel" />}
    </>
  )
}
