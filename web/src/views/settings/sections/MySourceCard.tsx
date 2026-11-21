import { ArrowLeftRight, ExternalLink, Minus, MoreHorizontal, Tags, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SourceStatus } from '../../../api.ts'
import { cardTopicOf } from '../../../lib/source-card.ts'
import { sourceState } from '../../../lib/settings-data.ts'
import Button from '../../../ui/Button.tsx'
import Menu, { MenuItem } from '../../../ui/Menu.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import SourceCard from '../../../ui/SourceCard.tsx'
import styles from '../../../ui/SourceCard.module.css'

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
  // Little read lately: said in the corner, and « Remplacer » offered.
  low: boolean
  open: boolean
  onMore: (open: boolean) => void
  onTakeOut: () => void
}

// Replace, change its topics, delete: the rarer actions, in a "⋯" menu beside the card's buttons.
const MoreMenu = ({ source, replace, retopic, deletable, removing, onRemove, open, onMore }: MySourceCardProps) => {
  const { t } = useTranslation()
  if (!replace && !retopic && !deletable) return null
  const then = (action: () => void) => () => {
    onMore(false)
    action()
  }
  const label = t('sources.moreFor', { name: source.name })
  return (
    <span className={styles.moreMenu}>
      <RoundButton
        icon={MoreHorizontal}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onMore(!open)}
      />
      <Menu open={open} onClose={() => onMore(false)} label={label} align="end">
        {replace && (
          <MenuItem icon={ArrowLeftRight} onClick={then(replace)}>
            {t('sources.replace')}
          </MenuItem>
        )}
        {retopic && (
          <MenuItem icon={Tags} onClick={then(retopic)}>
            {t('sources.changeTopics')}
          </MenuItem>
        )}
        {deletable && (
          <MenuItem icon={Trash2} tone="danger" disabled={removing} onClick={then(onRemove)}>
            {t('sources.delete')}
          </MenuItem>
        )}
      </Menu>
    </span>
  )
}

// What is wrong with it, in the corner: a feed that fails, or a source little read.
const Corner = ({ source, low }: { source: SourceStatus; low: boolean }) => {
  const { t } = useTranslation()
  if (sourceState(source) === 'error') {
    const title = source.error ? t('sources.errorTitle', { error: source.error }) : undefined
    return (
      <span className={styles.warning} title={title}>
        <TriangleAlert size={13} aria-hidden="true" /> {t('sources.status.error')}
      </span>
    )
  }
  return low ? <span>{t('sourceCard.low')}</span> : null
}

// A source of Mes sources: Retirer, its site, and the "⋯" menu.
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
      corner={<Corner source={source} low={low} />}
      actions={
        <>
          <Button compact icon={Minus} aria-label={t('catalogue.remove', { name: source.name })} onClick={onTakeOut}>
            {t('sourceCard.remove')}
          </Button>
          <RoundButton
            icon={ExternalLink}
            label={t('addSource.seeSite', { name: source.name })}
            title={t('catalogue.openSite')}
            href={source.site}
            external
          />
          <MoreMenu {...props} />
        </>
      }
    />
  )
}

export default MySourceCard
