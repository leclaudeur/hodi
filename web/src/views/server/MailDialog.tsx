import { AtSign, Globe, Hash, KeyRound, Server, UserRound } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type MailSecurity, RequestError, type ServerMail as Mail, setServerMail } from '../../api.ts'
import { showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import PasswordField from '../../ui/PasswordField.tsx'
import Segmented from '../../ui/Segmented.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import TextField from '../../ui/TextField.tsx'
import householdStyles from '../household/Household.module.css'
import serverStyles from './Server.module.css'

const SECURITIES: MailSecurity[] = ['starttls', 'tls', 'none']

// The usual port of each kind of connection: a port the admin left at a usual one follows the choice.
const USUAL_PORT: Record<MailSecurity, number> = { tls: 465, starttls: 587, none: 25 }

// The form's answers, and their saving.
const useMailForm = (mail: Mail | null, onClose: () => void, onSaved: (mail: Mail) => void) => {
  const { t } = useTranslation()
  const [host, setHost] = useState(mail?.host ?? '')
  const [security, setSecurity] = useState<MailSecurity>(mail?.security ?? 'starttls')
  const [port, setPort] = useState(String(mail?.port ?? USUAL_PORT.starttls))
  const [user, setUser] = useState(mail?.user ?? '')
  // Empty: the saved password stays, if there is one.
  const [password, setPassword] = useState('')
  const [sender, setSender] = useState(mail?.sender ?? '')
  // The address this page is open at, until the admin says another.
  const [appUrl, setAppUrl] = useState(mail?.appUrl ?? window.location.origin)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = (next: MailSecurity) => {
    if (Object.values(USUAL_PORT).includes(Number(port))) setPort(String(USUAL_PORT[next]))
    setSecurity(next)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const name = user.trim()
    try {
      onSaved(
        await setServerMail({
          host: host.trim(),
          port: Number(port),
          security,
          user: name || null,
          ...(name && password ? { password } : {}),
          ...(name ? {} : { password: null }),
          sender: sender.trim(),
          appUrl: appUrl.trim()
        })
      )
      showSaved(t('server.mail.saved'))
      onClose()
    } catch (failure) {
      setError(
        failure instanceof RequestError && failure.status === 400
          ? t('server.mail.invalid')
          : t('server.mail.saveFailed')
      )
      setSaving(false)
    }
  }

  return {
    ...{ host, setHost, security, choose, port, setPort, user, setUser, password, setPassword },
    ...{ sender, setSender, appUrl, setAppUrl, saving, error, submit }
  }
}

type MailForm = ReturnType<typeof useMailForm>

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className={householdStyles.field}>
    <span className={householdStyles.fieldLabel}>{label}</span>
    {children}
  </div>
)

// Where the mail server is, and how to reach it.
const ServerFields = ({ form }: { form: MailForm }) => {
  const { t } = useTranslation()
  const { host, setHost, port, setPort, security, choose } = form
  return (
    <>
      <div className={serverStyles.hostRow}>
        <Field label={t('server.mail.host')}>
          <TextField
            icon={Server}
            aria-label={t('server.mail.host')}
            placeholder="smtp.example.com"
            autoCapitalize="off"
            spellCheck={false}
            required
            maxLength={253}
            value={host}
            onChange={event => setHost(event.target.value)}
          />
        </Field>
        <Field label={t('server.mail.port')}>
          <TextField
            icon={Hash}
            aria-label={t('server.mail.port')}
            inputMode="numeric"
            pattern="[0-9]{1,5}"
            required
            value={port}
            onChange={event => setPort(event.target.value.replace(/\D/g, '').slice(0, 5))}
          />
        </Field>
      </div>
      <Field label={t('server.mail.security')}>
        <Segmented
          label={t('server.mail.security')}
          wide
          value={security}
          options={SECURITIES.map(value => ({ value, label: t(`server.mail.securities.${value}`) }))}
          onChange={choose}
        />
      </Field>
    </>
  )
}

// Its sign-in, the sender's address and the address the e-mails' links open.
const SenderFields = ({ form, mail }: { form: MailForm; mail: Mail | null }) => {
  const { t } = useTranslation()
  const { user, setUser, password, setPassword, sender, setSender, appUrl, setAppUrl } = form
  return (
    <>
      <Field label={t('server.mail.user')}>
        <TextField
          icon={UserRound}
          aria-label={t('server.mail.user')}
          placeholder={t('server.mail.userPlaceholder')}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={254}
          value={user}
          onChange={event => setUser(event.target.value)}
        />
      </Field>
      {user.trim() && (
        <Field label={t('server.mail.password')}>
          <PasswordField
            icon={KeyRound}
            aria-label={t('server.mail.password')}
            autoComplete="new-password"
            placeholder={mail?.hasPassword ? t('server.mail.passwordKept') : undefined}
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
        </Field>
      )}
      <Field label={t('server.mail.sender')}>
        <TextField
          icon={AtSign}
          type="email"
          aria-label={t('server.mail.sender')}
          placeholder="hodi@example.com"
          required
          maxLength={254}
          value={sender}
          onChange={event => setSender(event.target.value)}
        />
      </Field>
      <Field label={t('server.mail.appUrl')}>
        <TextField
          icon={Globe}
          type="url"
          aria-label={t('server.mail.appUrl')}
          placeholder="https://hodi.example.com"
          required
          maxLength={269}
          value={appUrl}
          onChange={event => setAppUrl(event.target.value)}
        />
      </Field>
    </>
  )
}

// The server, its sign-in and the sender's address, in one form: they only work together.
const MailDialog = ({
  mail,
  onClose,
  onSaved
}: {
  mail: Mail | null
  onClose: () => void
  onSaved: (mail: Mail) => void
}) => {
  const { t } = useTranslation()
  const form = useMailForm(mail, onClose, onSaved)

  return (
    <Dialog open onClose={onClose} title={t('server.mail.dialogTitle')} intro={t('server.mail.dialogIntro')}>
      <form className={householdStyles.form} onSubmit={event => void form.submit(event)}>
        <ServerFields form={form} />
        <SenderFields form={form} mail={mail} />
        {form.error && <StatusLine tone="error">{form.error}</StatusLine>}
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" look="primary" busy={form.saving}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

export default MailDialog
