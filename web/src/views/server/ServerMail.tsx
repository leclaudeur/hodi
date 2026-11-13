import { Pencil, Send, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, type ServerMail as Mail, getServerMail, removeServerMail, sendTestMail } from '../../api.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import StatusLine from '../../ui/StatusLine.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow, { type RowAction } from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import MailDialog from './MailDialog.tsx'

const TEST_FAILURES = new Map<string, 'server.mail.failedAuth' | 'server.mail.failedRefused'>([
  ['mail_auth', 'server.mail.failedAuth'],
  ['mail_refused', 'server.mail.failedRefused']
])

interface MailRowsProps {
  mail: Mail
  change: RowAction
  testing: boolean
  onTest: () => void
  onRemove: () => void
}

// The mail server as set, then its test and its removal.
const MailRows = ({ mail, change, testing, onTest, onRemove }: MailRowsProps) => {
  const { t } = useTranslation()
  return (
    <>
      <h2 className={styles.label}>{t('server.mail.server')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('server.mail.host')}
          value={t('server.mail.hostValue', {
            host: mail.host,
            port: mail.port,
            security: t(`server.mail.securities.${mail.security}`)
          })}
          action={change}
        />
        <SettingRow label={t('server.mail.user')} value={mail.user ?? t('server.mail.noUser')} action={change} />
        <SettingRow label={t('server.mail.sender')} value={mail.sender} action={change} />
        <SettingRow label={t('server.mail.appUrl')} value={mail.appUrl ?? t('server.mail.noAppUrl')} action={change} />
      </div>
      <div className={styles.card}>
        <SettingRow
          label={t('server.mail.test')}
          hint={t('server.mail.testHint')}
          action={{ label: t('server.mail.testButton'), icon: Send, busy: testing, onClick: onTest }}
        />
        <SettingRow
          label={t('server.mail.remove')}
          hint={t('server.mail.removeHint')}
          action={{ label: t('server.mail.removeButton'), icon: Trash2, look: 'danger', onClick: onRemove }}
        />
      </div>
    </>
  )
}

// Serveur › E-mail: the mail server Hodi sends its e-mails through, and a test e-mail to the admin's own address.
const ServerMail = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const [mail, setMail] = useState<Mail | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    getServerMail()
      .then(setMail)
      .catch(() => setFailed(true))
  }, [])

  const test = async () => {
    setTesting(true)
    try {
      const { to } = await sendTestMail()
      showSaved(t('server.mail.testSent', { email: to }))
    } catch (failure) {
      const code = failure instanceof RequestError ? failure.code : null
      showError(t(TEST_FAILURES.get(code ?? '') ?? 'server.mail.failedUnreachable'))
    }
    setTesting(false)
  }

  const remove = () =>
    askToConfirm({
      title: t('confirm.removeMail.title'),
      message: t('confirm.removeMail.message'),
      label: t('confirm.removeMail.button'),
      onConfirm: () =>
        void removeServerMail()
          .then(() => {
            setMail(null)
            showSaved(t('server.mail.removed'))
          })
          .catch(() => showError(t('server.mail.saveFailed')))
    })

  const change = { label: t('common.change'), icon: Pencil, onClick: () => setEditing(true) }

  return (
    <SectionPage title={t('server.titles.mail')} intro={t('server.mail.intro')} layout={layout}>
      {failed && <StatusLine tone="error">{t('server.mail.loadFailed')}</StatusLine>}
      {mail === null && (
        <div className={styles.card}>
          <SettingRow
            label={t('server.mail.server')}
            hint={t('server.mail.notSet')}
            action={{ label: t('server.mail.set'), icon: Pencil, onClick: () => setEditing(true) }}
          />
        </div>
      )}
      {mail && <MailRows mail={mail} change={change} testing={testing} onTest={() => void test()} onRemove={remove} />}
      {editing && mail !== undefined && <MailDialog mail={mail} onClose={() => setEditing(false)} onSaved={setMail} />}
    </SectionPage>
  )
}

export default ServerMail
