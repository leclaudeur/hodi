import { Check, MessageSquare, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Profile, shareArticle } from '../../api.ts'
import { getLanguage } from '../../lib/i18n.ts'
import { useProfiles } from '../../lib/profiles.ts'
import { useShareTargets } from '../../lib/shares.ts'
import { showDone, showError } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import ProfileAvatar from '../../ui/ProfileAvatar.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import TextField from '../../ui/TextField.tsx'
import styles from './ShareToButton.module.css'
import RichText from '../../ui/RichText.tsx'

interface ShareToButtonProps {
  articleId: string
  size: 34 | 44
}

// As the server takes it.
const MAX_NOTE_LENGTH = 140

// "Léa, Tom et Max", in the interface language.
const names = (list: string[]) => new Intl.ListFormat(getLanguage(), { type: 'conjunction' }).format(list)

// The profiles to send to, each ticked or not.
const ProfilePicks = ({
  profiles,
  picked,
  onToggle
}: {
  profiles: Profile[]
  picked: number[]
  onToggle: (id: number) => void
}) => (
  <ul className={styles.list}>
    {profiles.map(profile => {
      const on = picked.includes(profile.id)
      return (
        <li key={profile.id}>
          <button
            type="button"
            role="checkbox"
            aria-checked={on}
            className={styles.row}
            onClick={() => onToggle(profile.id)}
          >
            <ProfileAvatar profile={profile} size={44} />
            <span className={styles.name}>{profile.name}</span>
            <span className={`${styles.check} ${on ? styles.on : ''}`} aria-hidden="true">
              {on && <Check size={12} strokeWidth={3} />}
            </span>
          </button>
        </li>
      )
    })}
  </ul>
)

// "Pour…": sends the article to other profiles of the household, into their "Partages". Only the profiles that
// share are offered; several can be picked. Hidden while nobody else in the household receives shares.
const ShareToButton = ({ articleId, size }: ShareToButtonProps) => {
  const { t } = useTranslation()
  const targets = useShareTargets()
  const household = useProfiles({ onError: () => {} })
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  const profiles = targets.flatMap(id => household?.profiles.filter(profile => profile.id === id) ?? [])
  if (profiles.length === 0 && !open) return null

  const start = () => {
    setPicked([])
    setNote('')
    setOpen(true)
  }

  const toggle = (id: number) => setPicked(ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))

  const send = async () => {
    setSending(true)
    try {
      await shareArticle(articleId, picked, note)
      showDone(
        t('shareTo.sent', { names: names(profiles.filter(profile => picked.includes(profile.id)).map(p => p.name)) })
      )
      setOpen(false)
    } catch {
      showError(t('shareTo.failed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <RoundButton icon={Send} label={t('shareTo.label')} size={size} className={styles.button} onClick={start} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('shareTo.title')}
        intro={profiles.length > 0 && <RichText i18nKey="dialogIntro.shareTo" />}
      >
        {profiles.length === 0 ? (
          <p className={styles.empty}>{t('shareTo.nobody')}</p>
        ) : (
          <ProfilePicks profiles={profiles} picked={picked} onToggle={toggle} />
        )}
        {profiles.length > 0 && (
          <TextField
            icon={MessageSquare}
            aria-label={t('shareTo.noteLabel')}
            placeholder={t('shareTo.notePlaceholder')}
            maxLength={MAX_NOTE_LENGTH}
            value={note}
            onChange={event => setNote(event.target.value)}
          />
        )}
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button look="primary" busy={sending} disabled={picked.length === 0} onClick={() => void send()}>
            {t('shareTo.send')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default ShareToButton
