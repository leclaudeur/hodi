import { Check, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type SourceReview, type TopicInfo, decideSource, getTopics } from '../../../api.ts'
import { askToConfirm, ownProof, type Proof } from '../../../lib/confirm.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import Button from '../../../ui/Button.tsx'
import { rich } from '../../../ui/rich.tsx'
import SourceAvatar from '../../../ui/SourceAvatar.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SettingRow from '../../settings/SettingRow.tsx'
import settingsStyles from '../../settings/Settings.module.css'
import TopicField from '../../settings/sections/TopicField.tsx'
import { hostOf } from '../../settings/sections/sources-model.ts'
import BlockSourceRow from './BlockSourceRow.tsx'
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

// What the source is: its logo, name, site and language, a way to its site, then what it says of itself.
export const SourceAbout = ({
  review
}: {
  review: Pick<SourceReview, 'id' | 'name' | 'site' | 'kind' | 'lang' | 'description'>
}) => {
  const { t } = useTranslation()
  const meta = [hostOf(review.site), t(`server.inbox.source.kinds.${review.kind}`), review.lang.toUpperCase()]
  return (
    <div className={settingsStyles.card}>
      <SettingRow
        lead={<SourceAvatar sourceId={review.id} sourceName={review.name} size={44} />}
        label={review.name}
        hint={meta.join(' · ')}
        action={{ label: t('catalogue.openSite'), icon: ExternalLink, href: review.site, external: true }}
      />
      {review.description && <p className={styles.description}>{review.description}</p>}
    </div>
  )
}

// A source added while the server validates them: what it is, its topics as the admin corrects them, whether it suits
// teens and children, then Refuser (asked first) or Accepter. Who added it is never shown.
const SourceReviewPanel = ({ review }: { review: SourceReview }) => {
  const { t } = useTranslation()
  const topics = useTopics()
  const [topicIds, setTopicIds] = useState(review.topicIds)
  const [teen, setTeen] = useState(false)
  const [child, setChild] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'refuse' | null>(null)
  const withTopics = review.kind === 'article' && topics.length > 0

  // Refuser comes with the password, and a refusal stays in the dialog that asked for it.
  const decide = async (decision: 'accept' | 'refuse', proof?: Proof) => {
    setBusy(decision)
    const chosen = { decision, teen, child, ...(withTopics && decision === 'accept' ? { topicIds } : {}) }
    try {
      await decideSource(review.id, chosen, proof)
      showSaved(
        t(decision === 'accept' ? 'server.inbox.source.accepted' : 'server.inbox.source.refused', {
          name: review.name
        })
      )
      inboxChanged()
    } catch (failure) {
      if (proof) throw failure
      showError(t('server.inbox.source.failed'))
    } finally {
      setBusy(null)
    }
  }

  const refuse = () =>
    askToConfirm({
      title: t('server.inbox.source.refuseTitle', { name: review.name }),
      message: rich(t('server.inbox.source.refuseText', { name: review.name })),
      label: t('server.inbox.source.refuse'),
      proof: ownProof(),
      onConfirm: proof => decide('refuse', proof)
    })

  return (
    <>
      <h2 className={settingsStyles.label}>{t('server.inbox.source.what')}</h2>
      <SourceAbout review={review} />
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
        <Button look="danger" icon={X} busy={busy === 'refuse'} disabled={busy !== null} onClick={refuse}>
          {t('server.inbox.source.refuse')}
        </Button>
        <Button
          look="primary"
          icon={Check}
          busy={busy === 'accept'}
          disabled={busy !== null || (withTopics && topicIds.length === 0)}
          onClick={() => void decide('accept')}
        >
          {t('server.inbox.source.accept')}
        </Button>
      </div>
      <BlockSourceRow source={review} />
    </>
  )
}

export default SourceReviewPanel
