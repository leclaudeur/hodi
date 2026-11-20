import { MailQuestion } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ChildAccount, type ParentInvitation, acceptParentInvitation, refuseParentInvitation } from '../../api.ts'
import { refreshProfiles } from '../../lib/profiles.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'

interface ParentInvitationsProps {
  invitations: ParentInvitation[]
  // Answered: gone from the list; accepted, the young one joins this parent's children.
  onAnswered: (childId: number, child: ChildAccount | null) => void
}

// Mon compte › Mes enfants, on top: another parent asks this adult to be a young one's parent too.
const ParentInvitations = ({ invitations, onAnswered }: ParentInvitationsProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState<ParentInvitation | null>(null)
  const [busy, setBusy] = useState(false)
  if (invitations.length === 0) return null
  const answer = async (invitation: ParentInvitation, accept: boolean) => {
    setBusy(true)
    try {
      const child = accept ? await acceptParentInvitation(invitation.childId) : null
      if (!accept) await refuseParentInvitation(invitation.childId)
      onAnswered(invitation.childId, child)
      if (child) void refreshProfiles().catch(() => {})
      showSaved(
        t(accept ? 'children.invitations.accepted' : 'children.invitations.refused', { name: invitation.childName })
      )
      setOpen(null)
    } catch {
      showError(t('children.invitations.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h2 className={styles.label}>{t('children.invitations.title')}</h2>
      <div className={styles.card}>
        {invitations.map(invitation => (
          <SettingRow
            key={invitation.childId}
            label={invitation.childName}
            hint={t('children.invitations.hint', { name: invitation.from })}
            action={{
              label: t('children.invitations.answer'),
              ariaLabel: t('children.invitations.answerLabel', { name: invitation.childName }),
              icon: MailQuestion,
              onClick: () => setOpen(invitation)
            }}
          />
        ))}
      </div>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={t('children.invitations.dialogTitle')}
        intro={t('children.invitations.dialogText', { from: open?.from ?? '', name: open?.childName ?? '' })}
      >
        {open && (
          <DialogActions>
            <Button busy={busy} onClick={() => void answer(open, false)}>
              {t('children.invitations.refuse')}
            </Button>
            <Button look="primary" busy={busy} onClick={() => void answer(open, true)}>
              {t('children.invitations.accept')}
            </Button>
          </DialogActions>
        )}
      </Dialog>
    </>
  )
}

export default ParentInvitations
