import { useState } from 'react'
import { sourceIconUrl } from '../api.ts'
import styles from './SourceAvatar.module.css'

// "Le Monde" gives "LM", "Polygon" "P", "The Verge" "V".
export const initialsOf = (name: string) =>
  name
    .replace(/^the\s+/i, '')
    .split(/[\s_-]+/)
    .filter(word => /[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map(word => [...word][0])
    .join('')
    .toUpperCase()

// Sources whose site has no icon, for this visit: no request for them again.
const missing = new Set<string>()

interface SourceAvatarProps {
  sourceId: string
  sourceName: string
  size?: 18 | 20 | 22 | 26 | 44
}

// The source's icon from its site; its initials on a neutral tile when it has none. Never round.
const SourceAvatar = ({ sourceId, sourceName, size = 18 }: SourceAvatarProps) => {
  // No id (an old saved item): the initials at once.
  const [failed, setFailed] = useState(() => !sourceId || missing.has(sourceId))

  return (
    <span className={`${styles.avatar} ${styles[`size${size}`]}`} aria-hidden="true">
      {failed ? (
        initialsOf(sourceName)
      ) : (
        <img
          src={sourceIconUrl(sourceId)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => {
            missing.add(sourceId)
            setFailed(true)
          }}
        />
      )}
    </span>
  )
}

export default SourceAvatar
