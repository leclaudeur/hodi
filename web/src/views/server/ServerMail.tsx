import { Pencil, Send, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, type ServerMail as Mail, getServerMail, removeServerMail, sendTestMail } from '../../api.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import StatusLine from '../../ui/StatusLine.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import MailDialog, { type MailPart } from './MailDialog.tsx'

const TEST_FAILURES = new Map<string, 'server.mail.failedAuth' | 'server.mail.failedRefused'>([
  ['mail_auth', 'server.mail.failedAuth'],
  ['mail_refused', 'server.mail.failedRefused']
])

interface MailRowsProps {
  mail: Mail | null
  onChange: (part: MailPart) => void
}

// The mail server, one row per thing to give, each with its own « Changer ».
const MailRows = ({ mail, onChange }: MailRowsProps) => {
  const { t } = useTranslation()
  const change = (part: MailPart) => ({ label: t('common.change'), icon: Pencil, onClick: () => onChange(part) })
  const host =
    mail?.host &&
    t('server.mail.hostValue', {
      host: mail.host,
      port: mail.port,
      security: t(`server.mail.securities.${mail.security}`)
    })
  return (
    <>
      <h2 className={styles.label}>{t('server.mail.server')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('server.mail.host')}
          value={host || undefined}
          hint={host ? undefined : t('server.mail.toFill')}
          action={change('server')}
        />
        <SettingRow
          label={t('server.mail.user')}
          value={mail?.user ?? undefined}
          hint={mail?.user ? undefined : t('server.mail.noUser')}
          action={change('login')}
        />
        <SettingRow
          label={t('server.mail.sender')}
          value={mail?.sender ?? undefined}
          hint={mail?.sender ? undefined : t('server.mail.toFill')}
          action={change('sender')}
        />
      </div>
    </>
  )
}

interface ActionsProps {
  testing: boolean
  onTest: () => void
  onRemove: () => void
}

// Once it is set: a test to the admin's own address, and its removal.
const MailActions = ({
  ready,
  testing,
  onTest,
  onRemove
}: { ready: boolean } & Pick<ActionsProps, 'testing' | 'onTest' | 'onRemove'>) => {
  const { t } = useTranslation()
  return (
    <div className={styles.card}>
      {ready && (
        <SettingRow
          label={t('server.mail.test')}
          hint={t('server.mail.testHint')}
          action={{ label: t('server.mail.testButton'), icon: Send, busy: testing, onClick: onTest }}
        />
      )}
      <SettingRow
        label={t('server.mail.remove')}
        hint={t('server.mail.removeHint')}
        action={{ label: t('server.mail.removeButton'), icon: Trash2, look: 'danger', onClick: onRemove }}
      />
    </div>
  )
}

// Serveur › E-mail: the mail server Hodi sends its e-mails through, and a test e-mail to the admin's own address.
const ServerMail = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const [mail, setMail] = useState<Mail | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<MailPart | null>(null)
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

  return (
    <SectionPage title={t('server.titles.mail')} intro={t('server.mail.intro')} layout={layout}>
      {failed && <StatusLine tone="error">{t('server.mail.loadFailed')}</StatusLine>}
      {mail !== undefined && <MailRows mail={mail} onChange={setEditing} />}
      {mail && <MailActions ready={mail.ready} testing={testing} onTest={() => void test()} onRemove={remove} />}
      {editing && mail !== undefined && (
        <MailDialog part={editing} mail={mail} onClose={() => setEditing(null)} onSaved={setMail} />
      )}
    </SectionPage>
  )
}

export default ServerMail
