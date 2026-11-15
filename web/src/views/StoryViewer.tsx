import { useEffect, useState } from 'react'
import type { FrontPageSection } from '../api.ts'
import { useDailySummary } from '../lib/daily-summary.ts'
import { timeAgo } from '../lib/format.ts'
import { useFrontPage } from '../lib/front-page.ts'
import { orderTopics, usePreferences } from '../lib/preferences.ts'
import { markRead } from '../lib/read-state.ts'
import { rememberList } from '../lib/reading-list.ts'
import { markStorySeen } from '../lib/seen-stories.ts'
import { DAILY_SUMMARY_HREF, FRONT_PAGE_HREF, storyHref } from '../lib/use-hash-route.ts'
import { isSectionSeen } from './StoriesRow.tsx'
import { DesktopStory, PhoneStory, useArrowKeys, useLockedPage } from './StoryFrames.tsx'

interface StoryViewerProps {
  topicId: string
  layout: 'desktop' | 'phone'
}

// "À la une" as stories: a topic's three most covered stories, one at a time, then the next unseen topic.
const StoryViewer = ({ topicId, layout }: StoryViewerProps) => {
  const sections = useFrontPage()
  const dailySummary = useDailySummary()
  const preferences = usePreferences()
  const [position, setPosition] = useState({ topicId, index: 0 })
  useLockedPage(layout === 'phone')
  // A new topic from the row starts at its first story.
  if (position.topicId !== topicId) setPosition({ topicId, index: 0 })

  const shown = sections ? orderTopics(sections, preferences).filter(section => section.items.length > 0) : []
  const sectionIndex = shown.findIndex(section => section.id === topicId)
  const section: FrontPageSection | undefined = shown[sectionIndex]
  const index = Math.min(position.index, (section?.items.length ?? 1) - 1)
  const item = section?.items[index]

  useEffect(() => {
    if (item) markStorySeen(item.id)
  }, [item])

  // A topic without stories (gone since, or hidden in the settings): back to the home.
  const missing = sections !== null && !item
  useEffect(() => {
    if (missing) window.location.replace(FRONT_PAGE_HREF)
  }, [missing])

  // After a topic's last story, the next topic not seen yet; none left closes the stories.
  const next = () => {
    if (!section) return
    if (index < section.items.length - 1) return setPosition({ topicId, index: index + 1 })
    const following = shown.slice(sectionIndex + 1).find(other => !isSectionSeen(other))
    window.location.hash = following ? storyHref(following.id) : FRONT_PAGE_HREF
  }

  // Before the first topic's first story: the "Résumé du jour", always first in the row.
  const previous = () => {
    if (index > 0) return setPosition({ topicId, index: index - 1 })
    const before = shown[sectionIndex - 1]
    window.location.hash = before ? storyHref(before.id) : DAILY_SUMMARY_HREF
  }

  useArrowKeys(next, previous)

  if (!section || !item) return null

  const open = () => {
    markRead(item.id)
    rememberList(section.items)
  }
  const age = timeAgo(item.publishedAt)?.toUpperCase()
  const hasPrevious = index > 0 || sectionIndex > 0 || dailySummary?.status !== 'unavailable'

  const frame = { section, item, index, age, open, next, previous }
  if (layout === 'desktop') return <DesktopStory {...frame} hasPrevious={hasPrevious} />
  return <PhoneStory {...frame} />
}

export default StoryViewer
