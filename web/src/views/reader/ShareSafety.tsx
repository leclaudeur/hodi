import { Ban, BellOff, CircleHelp, Flag, Megaphone, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, SHARE_REPORT_REASONS, type ShareReportReason, reportShare } from '../../api.ts'
import { updatePreferences, usePreferences } from '../../lib/preferences.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import RadioCards from '../../ui/RadioCards.tsx'
import RichText from '../../ui/RichText.tsx'
import styles from './ShareNote.module.css'

const ICONS = { harassment: Ban, hateful: ShieldAlert, spam: Megaphone, other: CircleHelp }

// What the server answered, said plainly: already reported, or the day's reports used up.
const failureOf = (failure: unknown) => {
  if (failure instanceof RequestError && failure.status === 409) return 'shareReport.already'
  if (failure instanceof RequestError && failure.status === 429) return 'shareReport.tooMany'
  return 'shareReport.failed'
}

interface ReportDialogProps {
  share: { articleId: string; from: number; name: string }
  open: boolean
  onClose: () => void
}

// Why this share should not have been sent, one reason, to the server's admin without who reports it.
const ReportShareDialog = ({ share, open, onClose }: ReportDialogProps) => {
  const { t } = useTranslation()
  const [reason, setReason] = useState<ShareReportReason | null>(null)
  const [sending, setSending] = useState(false)
  const cards = SHARE_REPORT_REASONS.map(id => {
    const Icon = ICONS[id]
    return {
      id,
      label: t(`shareReport.reasons.${id}.label`),
      hint: t(`shareReport.reasons.${id}.hint`),
      icon: <Icon size={18} />
    }
  })
  const send = () => {
    if (!reason) return
    setSending(true)
    reportShare(share.articleId, share.from, reason)
      .then(() => {
        showSaved(t('shareReport.sent'))
        onClose()
      })
      .catch((failure: unknown) => showError(t(failureOf(failure))))
      .finally(() => setSending(false))
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('shareReport.title')}
      intro={<RichText i18nKey="shareReport.intro" values={{ name: share.name }} />}
    >
      <RadioCards
        label={t('shareReport.reasonsLabel')}
        cards={cards}
        value={reason}
        onChange={id => setReason(id as ShareReportReason)}
      />
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button look="primary" icon={Flag} busy={sending} disabled={!reason} onClick={send}>
          {t('shareReport.send')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Under a received share: « Signaler » to the server's admin, and « Ne plus recevoir ses partages », taken back in
// Réglages › Partages.
const ShareSafety = ({ share }: { share: ReportDialogProps['share'] }) => {
  const { t } = useTranslation()
  const { mutedSharers } = usePreferences()
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const mute = () => {
    updatePreferences({ mutedSharers: [...mutedSharers, share.from] })
    showSaved(t('shareReport.muted', { name: share.name }))
  }
  return (
    <div className={styles.safety}>
      <Button compact icon={BellOff} aria-label={t('shareReport.muteLabel', { name: share.name })} onClick={mute}>
        {t('shareReport.mute')}
      </Button>
      <Button
        compact
        icon={Flag}
        aria-label={t('shareReport.label', { name: share.name })}
        onClick={() => {
          setUsed(true)
          setOpen(true)
        }}
      >
        {t('shareReport.button')}
      </Button>
      {used && <ReportShareDialog share={share} open={open} onClose={() => setOpen(false)} />}
    </div>
  )
}

export default ShareSafety
