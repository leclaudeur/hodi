import { Download, History } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, type ServerBackups, downloadBackup, restoreBackup } from '../../api.ts'
import { useTwoFactorOn } from '../../lib/two-factor.ts'
import { currentBoot } from '../../plugins/restart.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import PasswordField from '../../ui/PasswordField.tsx'
import PinField from '../../ui/PinField.tsx'
import RichText from '../../ui/RichText.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import householdStyles from '../household/Household.module.css'
import { whenOf } from './backup-time.ts'

export type Copy = ServerBackups['copies'][number]

// A wrong password or code says so; anything else gets the dialog's own message.
const refusalOf = (failure: unknown, texts: { wrong: string; wrongCode: string; other: string }) => {
  if (failure instanceof RequestError && failure.code === 'invalid_password') return texts.wrong
  if (failure instanceof RequestError && failure.code === 'invalid_code') return texts.wrongCode
  return texts.other
}

const SubmitButton = ({ restoring, busy, disabled }: { restoring: boolean; busy: boolean; disabled: boolean }) => {
  const { t } = useTranslation()
  return restoring ? (
    <Button type="submit" look="danger" icon={History} busy={busy} disabled={disabled}>
      {t('server.backups.restore')}
    </Button>
  ) : (
    <Button type="submit" look="primary" icon={Download} busy={busy} disabled={disabled}>
      {t('server.backups.download')}
    </Button>
  )
}

// Sends the password and the code with the copy's download or its putting back; a refusal says why.
const useSend = (
  copy: Copy,
  restoring: boolean,
  { onClose, onRestore }: { onClose: () => void; onRestore: (before: string | null) => void }
) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrong = t('settings.account.wrongPassword')
  const wrongCode = t('confirm.proof.wrongCode')

  const submit = async (event: FormEvent, { password, code }: { password: string; code: string }) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (restoring) {
        const before = await currentBoot()
        await restoreBackup(copy.name, { password, code })
        onRestore(before)
        return
      }
      await downloadBackup(copy.name, { password, code })
      onClose()
    } catch (failure) {
      setError(
        refusalOf(failure, {
          wrong,
          wrongCode,
          other: t(restoring ? 'server.backups.restoreFailed' : 'server.backups.downloadFailed')
        })
      )
      setBusy(false)
    }
  }
  return { busy, error, setError, wrong, wrongCode, submit }
}

// A copy holds everyone's data: it is downloaded, or put back in place of the database, with the account's password.
// Put back, it answers with the boot Hodi had before, for the restart screen.
const BackupPasswordDialog = ({
  copy,
  mode,
  onClose,
  onRestore
}: {
  copy: Copy
  mode: 'download' | 'restore'
  onClose: () => void
  onRestore: (before: string | null) => void
}) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  // The app's code too: the server's admin always has « Validation en deux étapes » on.
  const askCode = useTwoFactorOn()
  const [code, setCode] = useState('')
  const restoring = mode === 'restore'
  const { busy, error, setError, wrong, wrongCode, submit } = useSend(copy, restoring, { onClose, onRestore })
  const send = (event: FormEvent) => submit(event, { password, code })

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(restoring ? 'server.backups.restoreTitle' : 'server.backups.downloadTitle')}
      intro={
        <RichText
          i18nKey={restoring ? 'server.backups.restoreIntro' : 'server.backups.downloadIntro'}
          values={whenOf(copy.at)}
        />
      }
    >
      <form className={householdStyles.form} onSubmit={event => void send(event)}>
        <div className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('settings.account.yourPassword')}</span>
          <PasswordField
            aria-label={t('settings.account.yourPassword')}
            autoComplete="current-password"
            required
            invalid={error === wrong}
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
        </div>
        {askCode && (
          <PinField
            label={t('confirm.proof.code')}
            length={6}
            masked={false}
            align="start"
            state={error === wrongCode ? 'wrong' : 'idle'}
            value={code}
            onChange={typed => {
              setCode(typed)
              if (error === wrongCode) setError(null)
            }}
          />
        )}
        {error && <StatusLine tone="error">{error}</StatusLine>}
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <SubmitButton restoring={restoring} busy={busy} disabled={!password || (askCode && code.length !== 6)} />
        </DialogActions>
      </form>
    </Dialog>
  )
}

export default BackupPasswordDialog
