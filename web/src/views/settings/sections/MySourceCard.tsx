import { ArrowLeftRight, ExternalLink, Minus, Moon, Tags, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SourceStatus } from '../../../api.ts'
import { cardTopicOf } from '../../../lib/source-card.ts'
import { sourceState } from '../../../lib/settings-data.ts'
import Button from '../../../ui/Button.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import SourceCard from '../../../ui/SourceCard.tsx'
import styles from '../../../ui/SourceCard.module.css'
import SourceReaders from '../../../ui/SourceReaders.tsx'
import ReportSourceButton from './ReportSourceButton.tsx'

export interface MySourceActions {
  replace: (() => void) | null
  retopic: (() => void) | null
  deletable: boolean
  removing: boolean
  onRemove: () => void
}

interface MySourceCardProps extends MySourceActions {
  source: SourceStatus
  topics: { id: string; label: string }[]
  // The topics filtered on: the card shows one of them first.
  chosenTopics: string[]
  // Little read lately: said on its logo, and « Remplacer » offered.
  low: boolean
  onTakeOut: () => void
}

// What is wrong with it, on its logo: a feed that fails (red), or a source little read (grey); its title says what.
const Badge = ({ source, low }: { source: SourceStatus; low: boolean }) => {
  const { t } = useTranslation()
  if (sourceState(source) === 'error') {
    const title = source.error ? t('sources.errorTitle', { error: source.error }) : t('sources.status.error')
    return (
      <span className={`${styles.badge} ${styles.badgeError}`} title={title} role="img" aria-label={title}>
        <TriangleAlert size={11} aria-hidden="true" />
      </span>
    )
  }
  if (!low) return null
  return (
    <span className={styles.badge} title={t('sourceCard.low')} role="img" aria-label={t('sourceCard.low')}>
      <Moon size={11} aria-hidden="true" />
    </span>
  )
}

// Its other actions, each a round with its name on hover: replace it, change its topics, report it, its site, delete
// it.
const OtherActions = ({ source, replace, retopic, deletable, removing, onRemove }: MySourceCardProps) => {
  const { t } = useTranslation()
  return (
    <>
      {replace && (
        <RoundButton
          size={34}
          icon={ArrowLeftRight}
          label={t('sources.replaceOf', { name: source.name })}
          title={t('sources.replace')}
          onClick={replace}
        />
      )}
      {retopic && (
        <RoundButton
          size={34}
          icon={Tags}
          label={t('sources.changeTopicsOf', { name: source.name })}
          title={t('sources.changeTopics')}
          onClick={retopic}
        />
      )}
      <ReportSourceButton source={source} />
      <RoundButton
        size={34}
        icon={ExternalLink}
        label={t('addSource.seeSite', { name: source.name })}
        title={t('catalogue.openSite')}
        href={source.site}
        external
      />
      {deletable && (
        <RoundButton
          size={34}
          variant="danger"
          icon={Trash2}
          label={t('sources.deleteOf', { name: source.name })}
          title={t('sources.delete')}
          disabled={removing}
          onClick={onRemove}
        />
      )}
    </>
  )
}

// A source of Mes sources: Retirer on the left, in red, as the catalogue's Ajouter; its other actions on the right.
const MySourceCard = (props: MySourceCardProps) => {
  const { t } = useTranslation()
  const { source, topics, chosenTopics, low, onTakeOut } = props
  const { topic, moreTopics } = cardTopicOf(topics, chosenTopics)
  return (
    <SourceCard
      sourceId={source.id}
      name={source.name}
      topic={topic}
      moreTopics={moreTopics}
      corner={<SourceReaders readers={source.readers} />}
      badge={<Badge source={source} low={low} />}
      start={
        <Button
          compact
          look="danger"
          icon={Minus}
          aria-label={t('catalogue.remove', { name: source.name })}
          onClick={onTakeOut}
        >
          {t('sourceCard.remove')}
        </Button>
      }
      end={<OtherActions {...props} />}
    />
  )
}

export default MySourceCard
