import { MessageSquare, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type SharePerson, shareArticle } from '../../api.ts'
import { getLanguage } from '../../lib/i18n.ts'
import { useShareTargets } from '../../lib/shares.ts'
import { showDone, showError } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import TextField from '../../ui/TextField.tsx'
import RichText from '../../ui/RichText.tsx'
import { HandleAdder, PersonPicks } from './SharePicks.tsx'
import styles from './ShareToButton.module.css'

interface ShareToButtonProps {
  articleId: string
  size: 34 | 44
}

// As the server takes it.
const MAX_NOTE_LENGTH = 140

// "Léa, Tom et Max", in the interface language.
const names = (list: string[]) => new Intl.ListFormat(getLanguage(), { type: 'conjunction' }).format(list)

// "Envoyer à…": sends the article to other people, into their "Partages". It offers the family, the accounts signed in
// on this device and whoever the profile shared with lately; an adult finds anyone else by their @username. Several can
// be picked. Hidden while nobody can be offered or found.
const ShareToButton = ({ articleId, size }: ShareToButtonProps) => {
  const { t } = useTranslation()
  const targets = useShareTargets()
  const [open, setOpen] = useState(false)
  const [found, setFound] = useState<SharePerson[]>([])
  const [picked, setPicked] = useState<number[]>([])
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  const offered = targets.people.filter(person => !found.some(other => other.id === person.id))
  const people = [...offered, ...found]
  if (people.length === 0 && !targets.byHandle && !open) return null

  const start = () => {
    setFound([])
    setPicked([])
    setNote('')
    setOpen(true)
  }

  const toggle = (id: number) => setPicked(ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))
  const add = (person: SharePerson) => {
    if (!people.some(other => other.id === person.id)) setFound(list => [...list, person])
    setPicked(ids => (ids.includes(person.id) ? ids : [...ids, person.id]))
  }

  const send = async () => {
    setSending(true)
    try {
      await shareArticle(articleId, picked, note)
      showDone(
        t('shareTo.sent', { names: names(people.filter(person => picked.includes(person.id)).map(p => p.name)) })
      )
      setOpen(false)
    } catch {
      showError(t('shareTo.failed'))
    } finally {
      setSending(false)
    }
  }

  const nobody = people.length === 0 && !targets.byHandle
  return (
    <>
      <RoundButton icon={Send} label={t('shareTo.label')} size={size} className={styles.button} onClick={start} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('shareTo.title')}
        intro={!nobody && <RichText i18nKey={targets.byHandle ? 'dialogIntro.shareToHandle' : 'dialogIntro.shareTo'} />}
      >
        {nobody && <p className={styles.empty}>{t('shareTo.nobody')}</p>}
        {people.length > 0 && <PersonPicks people={people} picked={picked} onToggle={toggle} />}
        {targets.byHandle && <HandleAdder onFound={add} />}
        {!nobody && (
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
