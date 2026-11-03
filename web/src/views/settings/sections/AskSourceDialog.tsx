import { typesAtOnce } from '../../../lib/use-media.ts'
import { Link } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PENDING_REQUESTS, RequestError, askForSource } from '../../../api.ts'
import { refreshMyRequests, useMyRequests } from '../../../lib/my-requests.ts'
import { showSaved } from '../../../lib/toast.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import TextField from '../../../ui/TextField.tsx'
import styles from './AskSourceDialog.module.css'
import RichText from '../../../ui/RichText.tsx'

const ERRORS = [
  'invalid',
  'blocked',
  'none',
  'empty',
  'failed',
  'reddit',
  'channel',
  'following',
  'pending',
  'full'
] as const

// "Demander une source": a teen pastes a site's link; the server finds its feed and its parents decide.
const AskSourceDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const [link, setLink] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Three waiting already: said at once, before a link is typed for nothing.
  const full = (useMyRequests(open)?.length ?? 0) >= MAX_PENDING_REQUESTS

  const close = () => {
    setLink('')
    setError(null)
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!link.trim()) return
    setSending(true)
    setError(null)
    try {
      await askForSource(link.trim())
      await refreshMyRequests()
      showSaved(t('requests.sent'))
      close()
    } catch (failure) {
      const code = failure instanceof RequestError ? failure.code : null
      const known = ERRORS.find(candidate => candidate === code)
      setError(known ? t(`requests.errors.${known}`) : t('requests.errors.other'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onClose={close} title={t('requests.ask')} intro={<RichText i18nKey="dialogIntro.ask" />}>
      <form className={styles.form} onSubmit={submit}>
        <TextField
          icon={Link}
          aria-label={t('requests.link')}
          data-tour="ask-link"
          inputMode="url"
          maxLength={500}
          autoComplete="off"
          value={link}
          placeholder={t('requests.placeholder')}
          onChange={event => {
            setLink(event.target.value)
            setError(null)
          }}
          autoFocus={typesAtOnce()}
        />
        {(error || full) && <StatusLine tone="error">{error ?? t('requests.errors.full')}</StatusLine>}
        <DialogActions>
          <Button type="button" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" look="primary" busy={sending} disabled={!link.trim() || full}>
            {t('requests.send')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

export default AskSourceDialog
