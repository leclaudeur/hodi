import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicInfo } from '../../../api.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import Segmented from '../../../ui/Segmented.tsx'
import TopicCapsule from '../../../ui/TopicCapsule.tsx'
import styles from '../Settings.module.css'
import AddSource from './AddSource.tsx'
import dialogStyles from './AddSourceDialog.module.css'
import SourceProposals, { useProposals } from './SourceProposals.tsx'
import SourceSuggestions from './SourceSuggestions.tsx'
import RichText from '../../../ui/RichText.tsx'

export interface AddSourceRequest {
  // The topic picked first.
  topicId: string | null
  // A little-read source the new one replaces: hidden once the new one is in.
  replacing: { id: string; name: string } | null
}

interface AddSourceDialogProps {
  topics: TopicInfo[]
  // null: closed.
  request: AddSourceRequest | null
  onClose: () => void
  onAdded: (id: string) => void
  onUnauthorized: () => void
}

// "Ajouter une source", over the page, one way at a time: a link pasted, or for a topic, the sites we propose and
// those the AI finds. The topics show until one is picked, then give way to its sites.
type Way = 'link' | 'topic'

interface WayProps {
  topics: TopicInfo[]
  request: AddSourceRequest
  way: Way
  picked: string | null
  onPick: (id: string | null) => void
  proposals: ReturnType<typeof useProposals>
  onAdded: (id: string) => void
  onUnauthorized: () => void
}

// The topics to pick from, until one is picked.
const TopicPicker = ({ topics, onPick }: { topics: TopicInfo[]; onPick: (id: string) => void }) => {
  const { t } = useTranslation()
  return (
    <>
      <h3 className={styles.label}>{t('settings.addSource.pickTopic')}</h3>
      <div className={dialogStyles.topics} data-tour="add-topics">
        {topics.map(choice => (
          <TopicCapsule
            key={choice.id}
            topicId={choice.id}
            label={choice.label}
            size="filter"
            onClick={() => onPick(choice.id)}
          />
        ))}
      </div>
    </>
  )
}

// The way picked: a link pasted, or the sites we propose and those the AI finds for a topic.
const WayContent = ({ topics, request, way, picked, onPick, proposals, onAdded, onUnauthorized }: WayProps) => {
  const { t } = useTranslation()
  const topic = topics.find(candidate => candidate.id === picked) ?? null
  if (way === 'link') {
    return <AddSource topics={topics} topicHint={picked} onAdded={onAdded} onUnauthorized={onUnauthorized} />
  }
  if (!topic) return <TopicPicker topics={topics} onPick={onPick} />
  return (
    <>
      <div className={dialogStyles.picked}>
        <TopicCapsule topicId={topic.id} label={topic.label} size="filter" selected href={null} />
        <Button onClick={() => onPick(null)}>{t('settings.addSource.changeTopic')}</Button>
      </div>
      {proposals && (
        <SourceProposals topic={topic} proposals={proposals} onAdded={onAdded} onUnauthorized={onUnauthorized} />
      )}
      <SourceSuggestions
        // A new topic: the last suggestions go.
        key={picked}
        topic={topic}
        replacing={request.replacing?.id ?? null}
        onAdded={onAdded}
        onUnauthorized={onUnauthorized}
      />
    </>
  )
}

const AddSourceDialog = ({ topics, request, onClose, onAdded, onUnauthorized }: AddSourceDialogProps) => {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<string | null>(null)
  const [way, setWay] = useState<Way>('link')
  const proposals = useProposals(request !== null, onUnauthorized)
  // Each opening starts on its own topic (the one of a source being replaced).
  const [opened, setOpened] = useState<AddSourceRequest | null>(null)
  if (request !== opened) {
    setOpened(request)
    if (request) {
      setPicked(request.topicId)
      setWay(request.topicId ? 'topic' : 'link')
    }
  }

  return (
    // Its content starts afresh at each opening, on its own topic.
    <Dialog
      open={request !== null}
      onClose={onClose}
      size="wide"
      title={request?.replacing ? t('settings.addSource.replaceTitle') : t('settings.addSource.title')}
      intro={
        request?.replacing ? (
          <RichText i18nKey="dialogIntro.replaceSource" values={{ name: request.replacing.name }} />
        ) : (
          <RichText i18nKey="dialogIntro.addSource" />
        )
      }
    >
      {request && (
        <>
          <div data-tour="add-way">
            <Segmented
              label={t('settings.addSource.how')}
              wide
              value={way}
              options={[
                { value: 'link', label: t('settings.addSource.byLink') },
                { value: 'topic', label: t('settings.addSource.forTopic') }
              ]}
              onChange={setWay}
            />
          </div>
          <WayContent
            topics={topics}
            request={request}
            way={way}
            picked={picked}
            onPick={setPicked}
            proposals={proposals}
            onAdded={onAdded}
            onUnauthorized={onUnauthorized}
          />
        </>
      )}
    </Dialog>
  )
}

export default AddSourceDialog
