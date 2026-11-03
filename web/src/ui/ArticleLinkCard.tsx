import { ExternalLink } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useArticleImage } from '../lib/article-image.ts'
import { fadeIn } from '../lib/fade-in.ts'
import styles from './ArticleLinkCard.module.css'
import Chip from './Chip.tsx'
import ReadingTime from './ReadingTime.tsx'
import SourceAvatar from './SourceAvatar.tsx'

interface ArticleLinkCardProps {
  articleId: string
  title: string
  href: string
  sourceId: string
  sourceName: string
  image?: string | null
  minutes?: number | null
  // Not readable in Hodi: marked "sur le site" (it opens on its summary and the way to the site).
  external?: boolean
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  // A key of the keyboard shortcuts (data-shortcut).
  shortcut?: string
}

// Another article, under the one being read ("Aussi couvert par", "Article suivant"): its title on two
// lines at most, where it comes from and how long it reads, its picture beside.
// Its picture as a 72-pixel square, from the server's smallest copy.
const Thumb = ({ articleId, image }: { articleId: string; image: string }) => {
  const picture = useArticleImage(articleId, image, '72px')
  return picture && <img {...fadeIn(styles.image)} {...picture} alt="" loading="lazy" decoding="async" />
}

const ArticleLinkCard = ({
  articleId,
  title,
  href,
  sourceId,
  sourceName,
  image,
  minutes,
  external = false,
  onClick,
  shortcut
}: ArticleLinkCardProps) => (
  <a className={styles.card} href={href} data-shortcut={shortcut} onClick={onClick}>
    <span className={styles.text}>
      <span className={styles.title}>{title}</span>
      <span className={styles.meta}>
        <SourceAvatar sourceId={sourceId} sourceName={sourceName} size={18} />
        <span className={styles.source}>{sourceName}</span>
        {external ? (
          <Chip>
            <ExternalLink size={12} aria-hidden="true" />
            SUR LE SITE
          </Chip>
        ) : (
          minutes != null && <ReadingTime minutes={minutes} />
        )}
      </span>
    </span>
    {image && <Thumb key={articleId} articleId={articleId} image={image} />}
  </a>
)

export default ArticleLinkCard
