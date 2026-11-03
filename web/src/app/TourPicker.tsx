import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type SourceProposal, TOPICS_CHANGED, type TopicSummary, addProposal, getProposals, getTopics } from '../api.ts'
import Button from '../ui/Button.tsx'
import TopicCapsule from '../ui/TopicCapsule.tsx'
import styles from './Tour.module.css'

interface TourPickerProps {
  // The first topic picked, which the tour then walks through, and how many sources were added for the others.
  onDone: (focus: TopicSummary, added: number) => void
  onSkip: () => void
}

// The tour's first screen: the topics with suggestions to pick from. The first one picked is the tour's own (its
// source is added step by step); each other gets its first suggestion that adds, at once.
const TourPicker = ({ onDone, onSkip }: TourPickerProps) => {
  const { t } = useTranslation()
  const [choices, setChoices] = useState<{ topic: TopicSummary; proposals: SourceProposal[] }[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let current = true
    Promise.all([getTopics(), getProposals()])
      .then(([topics, proposals]) => {
        if (!current) return
        setChoices(
          topics
            .map(topic => ({ topic, proposals: proposals.filter(proposal => proposal.topicId === topic.id) }))
            .filter(choice => choice.proposals.length > 0)
        )
      })
      .catch(() => current && setChoices([]))
    return () => {
      current = false
    }
  }, [])

  const toggle = (id: string) => setPicked(ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))

  const go = async () => {
    const chosen = picked.flatMap(id => choices?.filter(choice => choice.topic.id === id) ?? [])
    const [focus, ...others] = chosen
    if (!focus) return
    setAdding(true)
    let added = 0
    for (const { topic, proposals } of others) {
      for (const proposal of proposals) {
        const outcome = await addProposal(proposal.id, [topic.id]).catch(() => null)
        if (outcome?.ok) {
          added += 1
          break
        }
      }
    }
    if (added > 0) window.dispatchEvent(new Event(TOPICS_CHANGED))
    onDone({ id: focus.topic.id, label: focus.topic.label }, added)
  }

  return (
    <>
      <div className={styles.picks} role="group" aria-label={t('nav.topics')}>
        {choices?.map(({ topic }) => (
          <TopicCapsule
            key={topic.id}
            topicId={topic.id}
            label={topic.label}
            size="filter"
            selected={picked.includes(topic.id)}
            onClick={() => !adding && toggle(topic.id)}
          />
        ))}
      </div>
      <div className={styles.foot}>
        <Button onClick={onSkip}>{t('tour.skip')}</Button>
        <Button look="primary" busy={adding} disabled={picked.length === 0} onClick={() => void go()}>
          {adding ? t('tour.adding') : t('common.continue')}
        </Button>
      </div>
    </>
  )
}

export default TourPicker
