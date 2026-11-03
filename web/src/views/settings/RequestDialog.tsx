import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type YouthTopic, answerSourceRequest, getYouthTopics } from '../../api.ts'
import { useProfiles } from '../../lib/profiles.ts'
import { refreshPendingRequests, setPendingRequests, usePendingRequests } from '../../lib/requests.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import { SETTINGS_HREF } from '../../lib/use-hash-route.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import SourceAvatar from '../../ui/SourceAvatar.tsx'
import TopicCapsule from '../../ui/TopicCapsule.tsx'
import styles from './RequestDialog.module.css'
import RichText from '../../ui/RichText.tsx'

// Where a new source goes when the teen's themes cannot be read.
const DEFAULT_TOPIC = 'monde'

const close = () => {
  window.location.hash = SETTINGS_HREF
}

// A teen's request, from the pile on top of Réglages or its notification: the source, the theme it goes under,
// Refuser or Accepter.
const RequestDialog = ({ requestId }: { requestId: number }) => {
  const { t } = useTranslation()
  const requests = usePendingRequests(true)
  const household = useProfiles({ onError: () => {} })
  const request = requests.find(entry => entry.id === requestId)
  const profile = household?.profiles.find(entry => entry.id === request?.profileId)
  const [topics, setTopics] = useState<YouthTopic[] | null>(null)
  const [topic, setTopic] = useState(DEFAULT_TOPIC)
  // The theme it goes under shows alone; "Changer" opens the others.
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'refuse' | null>(null)
  // The list is asked again on opening: until it answers, an unknown id is not yet "gone".
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void refreshPendingRequests().then(() => setLoaded(true))
  }, [])

  const profileId = request?.profileId
  useEffect(() => {
    if (profileId === undefined) return
    getYouthTopics(profileId)
      .then(all => {
        const shown = all.filter(entry => entry.on)
        setTopics(shown)
        if (!shown.some(entry => entry.id === DEFAULT_TOPIC) && shown[0]) setTopic(shown[0].id)
      })
      .catch(() => setTopics([]))
  }, [profileId])

  const answer = async (accept: boolean) => {
    if (!request) return
    setBusy(accept ? 'accept' : 'refuse')
    try {
      setPendingRequests(
        await answerSourceRequest(
          request.id,
          accept,
          accept && channel === false && topics?.length ? [topic] : undefined
        )
      )
      showSaved(
        accept
          ? t('requests.accepted', { source: request.source.name, name: profile?.name ?? '' })
          : t('requests.refused')
      )
      close()
    } catch {
      showError(t('requests.answerFailed'))
      setBusy(null)
    }
  }

  // A channel goes to "Vidéos", where the server files it: no theme to choose.
  const channel = request ? request.source.kind === 'video' : null
  const chosen = channel ? undefined : topics?.find(entry => entry.id === topic)
  const host = request
    ? (request.source.domains[0] ?? (URL.canParse(request.source.url) ? new URL(request.source.url).hostname : ''))
    : ''

  if (!request)
    return (
      <Dialog open={loaded} onClose={close} title={t('requests.title')}>
        <p className={styles.text}>{t('requests.gone')}</p>
        <DialogActions>
          <Button look="primary" onClick={close}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>
    )

  return (
    <Dialog
      open
      onClose={close}
      size="wide"
      title={t('requests.dialogTitle')}
      intro={
        <RichText
          i18nKey={channel ? 'dialogIntro.requestChannel' : 'dialogIntro.request'}
          values={{ name: profile?.name ?? '' }}
        />
      }
    >
      <div className={styles.body}>
        <div className={styles.source}>
          <SourceAvatar sourceId="" sourceName={request.source.name} size={44} />
          <span className={styles.sourceText}>
            <span className={styles.name}>{request.source.name}</span>
            <span className={styles.host}>{host}</span>
          </span>
        </div>
        {chosen && (
          <div className={styles.topics} role="group" aria-label={t('requests.topic')}>
            <span className={styles.label}>{t('requests.topic')}</span>
            <div className={`${styles.capsules} ${choosing ? '' : styles.collapsed}`}>
              {choosing ? (
                (topics ?? []).map(entry => (
                  <TopicCapsule
                    key={entry.id}
                    topicId={entry.id}
                    label={entry.label}
                    size="filter"
                    selected={entry.id === topic}
                    onClick={() => {
                      setTopic(entry.id)
                      setChoosing(false)
                    }}
                  />
                ))
              ) : (
                <>
                  <TopicCapsule topicId={chosen.id} label={chosen.label} size="filter" href={null} />
                  {(topics?.length ?? 0) > 1 && (
                    <Button compact onClick={() => setChoosing(true)}>
                      {t('requests.changeTopic')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <DialogActions>
        <Button onClick={() => void answer(false)} busy={busy === 'refuse'} disabled={busy !== null}>
          {t('requests.refuse')}
        </Button>
        <Button look="primary" onClick={() => void answer(true)} busy={busy === 'accept'} disabled={busy !== null}>
          {t('requests.accept')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default RequestDialog
