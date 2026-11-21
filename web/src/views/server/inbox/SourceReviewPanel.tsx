import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type SourceReview, type TopicInfo, decideSource, getTopics } from '../../../api.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import Button from '../../../ui/Button.tsx'
import SourceAvatar from '../../../ui/SourceAvatar.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SettingRow from '../../settings/SettingRow.tsx'
import settingsStyles from '../../settings/Settings.module.css'
import TopicField from '../../settings/sections/TopicField.tsx'
import { hostOf } from '../../settings/sections/sources-model.ts'
import styles from './Inbox.module.css'
import { inboxChanged } from './use-inbox.ts'

// The topics to choose from; none when this account reads no topic list (a server's admin with no profile).
const useTopics = () => {
  const [topics, setTopics] = useState<TopicInfo[]>([])
  useEffect(() => {
    getTopics()
      .then(setTopics)
      .catch(() => setTopics([]))
  }, [])
  return topics
}

// A source added while the server validates them: what it is, its topics as the admin corrects them, « OK ados »
// and « OK enfants », then Refuser or Accepter. Who added it is never shown.
const SourceReviewPanel = ({ review }: { review: SourceReview }) => {
  const { t } = useTranslation()
  const topics = useTopics()
  const [topicIds, setTopicIds] = useState(review.topicIds)
  const [teen, setTeen] = useState(false)
  const [child, setChild] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'refuse' | null>(null)
  const withTopics = review.kind === 'article' && topics.length > 0

  const decide = (decision: 'accept' | 'refuse') => {
    setBusy(decision)
    decideSource(review.id, { decision, teen, child, ...(withTopics && decision === 'accept' ? { topicIds } : {}) })
      .then(() => {
        showSaved(
          t(decision === 'accept' ? 'server.inbox.source.accepted' : 'server.inbox.source.refused', {
            name: review.name
          })
        )
        inboxChanged()
      })
      .catch(() => showError(t('server.inbox.source.failed')))
      .finally(() => setBusy(null))
  }

  return (
    <>
      <h2 className={settingsStyles.label}>{t('server.inbox.source.what')}</h2>
      <div className={settingsStyles.card}>
        <div className={styles.source}>
          <SourceAvatar sourceId={review.id} sourceName={review.name} size={44} />
          <span className={styles.sourceText}>
            <a className={styles.sourceName} href={review.site} target="_blank" rel="noreferrer">
              {review.name}
            </a>
            <span className={styles.sourceMeta}>
              {[hostOf(review.site), t(`server.inbox.source.kinds.${review.kind}`), review.lang.toUpperCase()].join(
                ' · '
              )}
            </span>
          </span>
        </div>
        {review.description && <p className={styles.description}>{review.description}</p>}
      </div>
      {withTopics && <h2 className={settingsStyles.label}>{t('server.inbox.source.topicsLabel')}</h2>}
      {withTopics && (
        <div className={`${settingsStyles.card} ${styles.topics}`}>
          <TopicField
            topics={topics}
            selected={topicIds}
            onChange={setTopicIds}
            label={t('server.inbox.source.topics', { name: review.name })}
          />
        </div>
      )}
      <h2 className={settingsStyles.label}>{t('server.inbox.source.young')}</h2>
      <div className={settingsStyles.card}>
        <SettingRow label={t('server.inbox.source.teen')} hint={t('server.inbox.source.teenHint')}>
          <Toggle label={t('server.inbox.source.teen')} checked={teen} onChange={setTeen} />
        </SettingRow>
        <SettingRow label={t('server.inbox.source.child')} hint={t('server.inbox.source.childHint')}>
          <Toggle label={t('server.inbox.source.child')} checked={child} onChange={setChild} />
        </SettingRow>
      </div>
      <div className={styles.decision}>
        <Button icon={X} busy={busy === 'refuse'} disabled={busy !== null} onClick={() => decide('refuse')}>
          {t('server.inbox.source.refuse')}
        </Button>
        <Button
          look="primary"
          icon={Check}
          busy={busy === 'accept'}
          disabled={busy !== null || (withTopics && topicIds.length === 0)}
          onClick={() => decide('accept')}
        >
          {t('server.inbox.source.accept')}
        </Button>
      </div>
    </>
  )
}

export default SourceReviewPanel
