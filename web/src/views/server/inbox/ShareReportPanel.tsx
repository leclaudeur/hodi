import { Ban, CircleHelp, Megaphone, ShieldAlert, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ShareReportView, ignoreShareReport } from '../../../api.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import Button from '../../../ui/Button.tsx'
import SettingRow from '../../settings/SettingRow.tsx'
import settingsStyles from '../../settings/Settings.module.css'
import { serverHref } from '../../../lib/use-hash-route.ts'
import styles from './Inbox.module.css'
import { inboxChanged } from './use-inbox.ts'

const REASON_ICONS = { harassment: Ban, hateful: ShieldAlert, spam: Megaphone, other: CircleHelp }

// A reported share as it was received: the article, its sender's word and the reason, then its sender's account,
// where it is blocked or deleted. Never who reported it.
const ShareReportPanel = ({ report }: { report: ShareReportView }) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const ignore = () => {
    setBusy(true)
    ignoreShareReport(report.id)
      .then(() => {
        showSaved(t('server.inbox.share.ignored'))
        inboxChanged()
      })
      .catch(() => showError(t('server.inbox.share.failed')))
      .finally(() => setBusy(false))
  }
  const ReasonIcon = REASON_ICONS[report.reason]
  return (
    <>
      <h2 className={settingsStyles.label}>{t('server.inbox.share.what')}</h2>
      <div className={settingsStyles.card}>
        <SettingRow label={report.item.title} hint={report.item.sourceName} />
        {report.note && <SettingRow label={t('server.inbox.share.note')} value={report.note} />}
        <SettingRow
          label={t('server.inbox.share.why')}
          value={t(`shareReport.reasons.${report.reason}.label`)}
          lead={<ReasonIcon size={20} aria-hidden="true" />}
        />
      </div>
      <h2 className={settingsStyles.label}>{t('server.inbox.share.sender')}</h2>
      <div className={settingsStyles.card}>
        <SettingRow
          label={<b>{report.senderName}</b>}
          hint={report.sender === null ? t('server.inbox.share.senderGone') : t('server.inbox.share.senderHint')}
          action={
            report.sender === null
              ? undefined
              : {
                  label: t('server.inbox.share.openAccount'),
                  icon: UserRound,
                  href: `${serverHref('accounts')}/${report.sender}`
                }
          }
        />
      </div>
      <div className={styles.decision}>
        <Button icon={X} busy={busy} onClick={ignore}>
          {t('server.inbox.share.ignore')}
        </Button>
      </div>
    </>
  )
}

export default ShareReportPanel
