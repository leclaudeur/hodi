import type { RelatedItem, TopicItem, TopicSummary } from '../api.ts'

// Other sources on the same story, by article id, from the topics seen in this visit:
// the reader lists them under the article.
const others = new Map<string, RelatedItem[]>()

// The topic each article was listed in (the reader's capsule): an article has none of its own.
const topics = new Map<string, TopicSummary>()

export const rememberRelated = (items: (TopicItem & { topicId?: string; topicLabel?: string })[]) => {
  for (const item of items) {
    if (item.topicId && item.topicLabel) topics.set(item.id, { id: item.topicId, label: item.topicLabel })
    const related = item.related ?? []
    if (related.length === 0) continue

    const { id, sourceId, sourceName, title, link, access, image, readingMinutes } = item
    const story = [{ id, sourceId, sourceName, title, link, access, image, readingMinutes }, ...related]
    story.forEach(member =>
      others.set(
        member.id,
        story.filter(other => other.id !== member.id)
      )
    )
  }
}

export const relatedOf = (id: string) => others.get(id) ?? []

export const topicOfArticle = (id: string) => topics.get(id) ?? null
