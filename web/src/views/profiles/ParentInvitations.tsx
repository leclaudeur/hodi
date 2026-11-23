import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { type ChildAccount, type ParentInvitation, acceptParentInvitation, refuseParentInvitation } from '../../api.ts'
import { refreshProfiles } from '../../lib/profiles.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import rows from '../../ui/NoticeRows.module.css'
import RoundButton from '../../ui/RoundButton.tsx'
import styles from '../settings/Settings.module.css'

interface ParentInvitationsProps {
  invitations: ParentInvitation[]
  // Answered: gone from the list; accepted, the young one joins this parent's children.
  onAnswered: (childId: number, child: ChildAccount | null) => void
}

// Mon compte › Mes enfants › Demandes: another parent asks this adult to be a young one's parent too. As a teen's
// requests on top of Réglages, answered right in the row.
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
    <section aria-label={t('children.invitations.title')}>
      <h2 className={styles.label}>{t('children.invitations.title')}</h2>
      <div className={`${rows.reactions} ${rows.settings}`}>
        {invitations.map(invitation => (
          <div key={invitation.childId} className={rows.row}>
            <span className={rows.text}>
              <span>
                <Trans
                  i18nKey="children.invitations.row"
                  values={{ from: invitation.from, name: invitation.childName }}
                  components={{ b: <b /> }}
                />
              </span>
              {invitation.childHandle && <span className={rows.title}>@{invitation.childHandle}</span>}
            </span>
            <RoundButton
              icon={X}
              label={t('children.invitations.refuseLabel', { name: invitation.childName })}
              title={t('children.invitations.refuse')}
              disabled={busy !== null}
              onClick={() => void answer(invitation, false)}
            />
            <RoundButton
              icon={Check}
              variant="primary"
              label={t('children.invitations.acceptLabel', { name: invitation.childName })}
              title={t('children.invitations.accept')}
              busy={busy === invitation.childId}
              disabled={busy !== null}
              onClick={() => void answer(invitation, true)}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

export default ParentInvitations
