import { EyeOff, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { REPORT_REASONS, type SourceReportView, decideReport } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import Button from '../../../ui/Button.tsx'
import { rich } from '../../../ui/rich.tsx'
import SettingRow from '../../settings/SettingRow.tsx'
import settingsStyles from '../../settings/Settings.module.css'
import styles from './Inbox.module.css'
import { SourceAbout } from './SourceReviewPanel.tsx'
import { inboxChanged } from './use-inbox.ts'

// A reported source: what it is, how many reported it and for which reasons (never who), then Ignorer, or Retirer du
// catalogue (asked first).
const SourceReportPanel = ({ report }: { report: SourceReportView }) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'ignore' | 'unlist' | null>(null)
  const decide = (decision: 'ignore' | 'unlist') => {
    setBusy(decision)
    decideReport(report.id, decision)
      .then(() => {
        showSaved(
          decision === 'ignore'
            ? t('server.inbox.report.ignored')
            : t('server.inbox.report.unlisted', { name: report.name })
        )
        inboxChanged()
      })
      .catch(() => showError(t('server.inbox.report.failed')))
      .finally(() => setBusy(null))
  }
  const unlist = () =>
    askToConfirm({
      title: t('server.inbox.report.unlistTitle', { name: report.name }),
      message: rich(t('server.inbox.report.unlistText', { name: report.name })),
      label: t('server.inbox.report.unlist'),
      onConfirm: () => decide('unlist')
    })
  const reasons = REPORT_REASONS.filter(reason => report.reasons[reason] > 0)
  return (
    <>
      <h2 className={settingsStyles.label}>{t('server.inbox.report.what')}</h2>
      <SourceAbout review={report} />
      <h2 className={settingsStyles.label}>{t('server.inbox.report.why')}</h2>
      <div className={settingsStyles.card}>
        {reasons.map(reason => (
          <SettingRow
            key={reason}
            label={t(`report.reasons.${reason}.label`)}
            value={t('server.inbox.report.count', { count: report.reasons[reason] })}
          />
        ))}
      </div>
      <div className={styles.decision}>
        <Button icon={X} busy={busy === 'ignore'} disabled={busy !== null} onClick={() => decide('ignore')}>
          {t('server.inbox.report.ignore')}
        </Button>
        <Button look="danger" icon={EyeOff} busy={busy === 'unlist'} disabled={busy !== null} onClick={unlist}>
          {t('server.inbox.report.unlist')}
        </Button>
      </div>
    </>
  )
}

export default SourceReportPanel
