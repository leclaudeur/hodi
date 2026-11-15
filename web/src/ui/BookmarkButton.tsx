import { Bookmark } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { type TopicItem, getArticle } from '../api.ts'
import { findSaved, save, unsave, useSaved } from '../lib/saved.ts'
import { showDone } from '../lib/toast.ts'
import RoundButton, { CARD_BUTTON } from './RoundButton.tsx'

// Saving also keeps the article text, so it opens once it has left the feeds.
export const toggleSaved = (item: TopicItem, saved: boolean) => {
  if (saved) {
    unsave(item.id)
    return
  }

  save(item)

  if (item.access === 'reader') {
    getArticle(item.id)
      .then(result => {
        if (result.status === 'ok') save(item, result.article)
      })
      // Saved without its text: it opens from the server while it knows the article.
      .catch(() => {})
  }
}

export const useIsSaved = (id: string) => useSaved().some(entry => entry.item.id === id)

interface BookmarkButtonProps {
  item: TopicItem
  // card: a small round on a card's meta row. image: over a picture. round: the reader's actions
  // (glass: floating over the mobile reader's picture).
  variant?: 'card' | 'image' | 'round' | 'glass'
  size?: 34 | 44
}

// On every card, everywhere: Antho saves without opening.
const BookmarkButton = ({ item, variant = 'card', size = 34 }: BookmarkButtonProps) => {
  const { t } = useTranslation()
  const saved = useIsSaved(item.id)
  const label = t(saved ? 'card.unsave' : 'card.save')
  const handleClick = (event: MouseEvent) => {
    // Cards are links: the bookmark must not open the article.
    event.preventDefault()
    event.stopPropagation()
    // Kept for "Annuler": put back with its text.
    const entry = saved ? findSaved(item.id) : undefined
    toggleSaved(item, saved)
    showDone(t(saved ? 'card.unsaved' : 'card.saved'), () => {
      if (saved) save(entry?.item ?? item, entry?.article ?? null)
      else unsave(item.id)
    })
  }

  return (
    <RoundButton
      icon={Bookmark}
      label={label}
      aria-pressed={saved}
      variant={variant === 'image' ? 'image' : saved ? 'on' : variant === 'glass' ? 'glass' : 'default'}
      filled={saved}
      size={variant === 'card' ? 28 : size}
      className={variant === 'card' ? CARD_BUTTON : undefined}
      onClick={handleClick}
    />
  )
}

export default BookmarkButton
