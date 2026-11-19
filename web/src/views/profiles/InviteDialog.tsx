import { Mail, QrCode, User } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, getInvitations, inviteAdult } from '../../api.ts'
import { showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import RichText from '../../ui/RichText.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import TextField from '../../ui/TextField.tsx'
import householdStyles from '../household/Household.module.css'
import CodeDialog from './CodeDialog.tsx'

const MAX_NAME = 40

interface InviteFormProps {
  onClose: () => void
  // The code made: it went by e-mail (sent), or the dialog shows it.
  onMade: (made: { code: string; sent: boolean; email: string }) => void
}

// Whether Serveur › E-mail can send the code: the address field shows then.
const useCanMail = () => {
  const [mail, setMail] = useState(false)
  useEffect(() => {
    let cancelled = false
    getInvitations()
      .then(answer => {
        if (!cancelled) setMail(answer.mail)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return mail
}

// A name to know the invitation by in Personnes invitées; with Serveur › E-mail set, an address to send the code to.
const InviteForm = ({ onClose, onMade }: InviteFormProps) => {
  const { t } = useTranslation()
  const mail = useCanMail()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = mail && email.trim() !== ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const made = await inviteAdult({ name: name.trim(), ...(sending ? { email: email.trim() } : {}) })
      onMade({ ...made, email: email.trim() })
    } catch (caught) {
      setError(
        t(caught instanceof RequestError && caught.status === 400 ? 'profiles.invite.invalid' : 'profiles.code.failed')
      )
      setSaving(false)
    }
  }

  return (
    <form className={householdStyles.form} onSubmit={event => void submit(event)}>
      <label className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('profiles.invite.name')}</span>
        <TextField
          icon={User}
          aria-label={t('profiles.invite.name')}
          value={name}
          maxLength={MAX_NAME}
          autoFocus
          onChange={event => setName(event.target.value)}
        />
      </label>
      {mail && (
        <label className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('profiles.invite.email')}</span>
          <TextField
            icon={Mail}
            type="email"
            aria-label={t('profiles.invite.email')}
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </label>
      )}
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" look="primary" icon={sending ? Mail : QrCode} busy={saving} disabled={!name.trim()}>
          {t(sending ? 'profiles.invite.send' : 'profiles.invite.create')}
        </Button>
      </DialogActions>
    </form>
  )
}

interface InviteDialogProps {
  open: boolean
  onClose: () => void
  // An invitation was made: Personnes invitées shows it.
  onInvited?: () => void
}

// « Inviter un adulte »: a name, an address when the server sends e-mails, then the code sent or shown.
const InviteDialog = ({ open, onClose, onInvited }: InviteDialogProps) => {
  const { t } = useTranslation()
  const [made, setMade] = useState<{ code: string } | null>(null)
  const close = () => {
    setMade(null)
    onClose()
  }
  const madeOne = (invitation: { code: string; sent: boolean; email: string }) => {
    onInvited?.()
    if (!invitation.sent) {
      setMade(invitation)
      return
    }
    showSaved(t('profiles.invite.sent', { email: invitation.email }))
    close()
  }

  if (made) return <CodeDialog key={made.code} target={null} make={() => Promise.resolve(made)} onClose={close} />
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('profiles.code.inviteTitle')}
      intro={<RichText i18nKey="profiles.invite.intro" />}
    >
      {open && <InviteForm onClose={close} onMade={madeOne} />}
    </Dialog>
  )
}

export default InviteDialog
