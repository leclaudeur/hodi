import { CircleHelp, Flag, Gavel, Megaphone, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { REPORT_REASONS, type ReportReason, reportSource } from '../../../api.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import RadioCards from '../../../ui/RadioCards.tsx'
import RichText from '../../../ui/RichText.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'

const ICONS = { illegal: Gavel, hateful: ShieldAlert, misleading: Megaphone, other: CircleHelp }

interface ReportDialogProps {
  source: { id: string; name: string }
  open: boolean
  onClose: () => void
}

// Why the source should not be here, one reason, sent to the server's admin without who sends it.
const ReportSourceDialog = ({ source, open, onClose }: ReportDialogProps) => {
  const { t } = useTranslation()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [sending, setSending] = useState(false)
  const cards = REPORT_REASONS.map(id => {
    const Icon = ICONS[id]
    return {
      id,
      label: t(`report.reasons.${id}.label`),
      hint: t(`report.reasons.${id}.hint`),
      icon: <Icon size={18} />
    }
  })
  const send = () => {
    if (!reason) return
    setSending(true)
    reportSource(source.id, reason)
      .then(() => {
        showSaved(t('report.sent'))
        onClose()
      })
      .catch(() => showError(t('report.failed')))
      .finally(() => setSending(false))
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('report.title', { name: source.name })}
      intro={<RichText i18nKey="report.intro" values={{ name: source.name }} />}
    >
      <RadioCards
        label={t('report.reasonsLabel')}
        cards={cards}
        value={reason}
        onChange={id => setReason(id as ReportReason)}
      />
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button look="primary" icon={Flag} busy={sending} disabled={!reason} onClick={send}>
          {t('report.send')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// « Signaler », a round on a source's card, and its dialog.
const ReportSourceButton = ({ source }: { source: { id: string; name: string } }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Mounted from the first click on, so that it closes as gently as it opens; never on every card for nothing.
  const [used, setUsed] = useState(false)
  return (
    <>
      <RoundButton
        size={34}
        icon={Flag}
        label={t('report.label', { name: source.name })}
        title={t('report.button')}
        onClick={() => {
          setUsed(true)
          setOpen(true)
        }}
      />
      {used && <ReportSourceDialog source={source} open={open} onClose={() => setOpen(false)} />}
    </>
  )
}

export default ReportSourceButton
