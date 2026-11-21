import { Check, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ChildAccount, type ParentInvitation, acceptParentInvitation, refuseParentInvitation } from '../../api.ts'
import { refreshProfiles } from '../../lib/profiles.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import Notice from '../../ui/Notice.tsx'
import RichText from '../../ui/RichText.tsx'
import { RowButton } from '../settings/SettingRow.tsx'
import own from './ParentInvitations.module.css'

interface ParentInvitationsProps {
  invitations: ParentInvitation[]
  // Answered: gone from the list; accepted, the young one joins this parent's children.
  onAnswered: (childId: number, child: ChildAccount | null) => void
}

// Mon compte › Mes enfants: another parent asks this adult to be a young one's parent too. An orange notice on top,
// as every request waiting for this adult, answered right there.
const ParentInvitations = ({ invitations, onAnswered }: ParentInvitationsProps) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<number | null>(null)
  if (invitations.length === 0) return null
  const answer = async (invitation: ParentInvitation, accept: boolean) => {
    setBusy(invitation.childId)
    try {
      const child = accept ? await acceptParentInvitation(invitation.childId) : null
      if (!accept) await refuseParentInvitation(invitation.childId)
      onAnswered(invitation.childId, child)
      if (child) void refreshProfiles().catch(() => {})
      showSaved(
        t(accept ? 'children.invitations.accepted' : 'children.invitations.refused', { name: invitation.childName })
      )
    } catch {
      showError(t('children.invitations.failed'))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className={own.list}>
      {invitations.map(invitation => (
        <Notice
          key={invitation.childId}
          tone="warning"
          icon={UserPlus}
          title={t('children.invitations.title', { from: invitation.from, name: invitation.childName })}
          side={
            <>
              <RowButton
                label={t('children.invitations.refuse')}
                ariaLabel={t('children.invitations.refuseLabel', { name: invitation.childName })}
                icon={X}
                disabled={busy !== null}
                onClick={() => void answer(invitation, false)}
              />
              <RowButton
                label={t('children.invitations.accept')}
                ariaLabel={t('children.invitations.acceptLabel', { name: invitation.childName })}
                look="primary"
                icon={Check}
                busy={busy === invitation.childId}
                disabled={busy !== null}
                onClick={() => void answer(invitation, true)}
              />
            </>
          }
        >
          <RichText
            i18nKey="children.invitations.text"
            values={{ from: invitation.from, name: invitation.childName }}
          />
        </Notice>
      ))}
    </div>
  )
}

export default ParentInvitations
