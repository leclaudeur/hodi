import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../../../api.ts'
import ChoiceField from '../../../ui/ChoiceField.tsx'
import TopicIcon from '../../../ui/TopicIcon.tsx'

// As many as the server takes for one source.
export const MAX_SOURCE_TOPICS = 8

interface TopicFieldProps {
  topics: TopicSummary[]
  selected: string[]
  onChange: (ids: string[]) => void
  label: string
}

// A source's topics, as tags in their colours.
const TopicField = ({ topics, selected, onChange, label }: TopicFieldProps) => {
  const { t } = useTranslation()
  const choices = topics.map(topic => ({
    id: topic.id,
    label: topic.label,
    topic: topic.id,
    icon: <TopicIcon topicId={topic.id} size={14} />
  }))
  return (
    <ChoiceField
      choices={choices}
      selected={selected}
      onChange={onChange}
      label={label}
      placeholder={t('addSource.typeTopic')}
      morePlaceholder={t('addSource.anotherTopic')}
      max={MAX_SOURCE_TOPICS}
    />
  )
}

export default TopicField
