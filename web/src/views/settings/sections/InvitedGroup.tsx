import { Mail, QrCode, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { type Invitation, cancelInvitation, getInvitations, renewInvitation } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { clockTime, localDay } from '../../../lib/format.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import RichText from '../../../ui/RichText.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import CodeDialog from '../../profiles/CodeDialog.tsx'
import SettingRow, { RowButton } from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import profileStyles from './ProfilesSection.module.css'

// The household's invitations still waiting, read again after each change.
export const useInvitations = (wanted: boolean) => {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const reload = useCallback(() => {
    if (!wanted) return
    getInvitations()
      .then(answer => setInvitations(answer.invitations))
      .catch(() => {})
  }, [wanted])
  useEffect(reload, [reload])
  return { invitations, reload }
}

// A code lasts a day: "jusqu'à 21:30" today, "jusqu'à demain, 21:30" after midnight.
const untilOf = (expiresAt: number, t: TFunction) =>
  t(
    localDay(expiresAt) === localDay()
      ? 'settings.profiles.invited.untilToday'
      : 'settings.profiles.invited.untilTomorrow',
    {
      time: clockTime(expiresAt)
    }
  )

interface InvitedRowProps {
  invitation: Invitation
  onRenew: (invitation: Invitation) => void
  onCancel: (invitation: Invitation) => void
}

const InvitedRow = ({ invitation, onRenew, onCancel }: InvitedRowProps) => {
  const { t } = useTranslation()
  const name = invitation.name ?? t('settings.profiles.invited.unnamed')
  const until = untilOf(invitation.expiresAt, t)
  const Icon = invitation.email ? Mail : QrCode
  return (
    <SettingRow
      as="li"
      lead={
        <span className={profileStyles.inviteMark}>
          <Icon size={20} aria-hidden="true" />
        </span>
      }
      label={name}
      value={invitation.email ? `${invitation.email} · ${until}` : t('settings.profiles.invited.code', { until })}
    >
      <RowButton
        label={t(invitation.email ? 'settings.profiles.invited.resend' : 'settings.profiles.invited.show')}
        ariaLabel={t(invitation.email ? 'settings.profiles.invited.resendName' : 'settings.profiles.invited.showName', {
          name
        })}
        icon={Icon}
        onClick={() => onRenew(invitation)}
      />
      <RoundButton
        icon={X}
        label={t('settings.profiles.invited.cancelName', { name })}
        variant="danger"
        size={38}
        onClick={() => onCancel(invitation)}
      />
    </SettingRow>
  )
}

// Personnes invitées: each invitation nobody used yet, under the name it was given. « Renvoyer » sends a new code to
// its address, « Voir le code » shows a new one; the cross cancels it.
const InvitedGroup = ({ invitations, onChange }: { invitations: Invitation[]; onChange: () => void }) => {
  const { t } = useTranslation()
  const [shown, setShown] = useState<{ code: string } | null>(null)

  const renew = (invitation: Invitation) => {
    renewInvitation(invitation.id)
      .then(made => {
        onChange()
        if (made.sent) showSaved(t('profiles.invite.sent', { email: invitation.email }))
        else setShown(made)
      })
      .catch(() => showError(t('profiles.code.failed')))
  }

  const cancel = (invitation: Invitation) => {
    const name = invitation.name ?? t('settings.profiles.invited.unnamed')
    askToConfirm({
      title: t('confirm.cancelInvitation.title'),
      message: <RichText i18nKey="confirm.cancelInvitation.message" values={{ name }} />,
      label: t('confirm.cancelInvitation.button'),
      onConfirm: () =>
        cancelInvitation(invitation.id)
          .then(() => showSaved(t('settings.profiles.invited.cancelled', { name })))
          .catch(() => showError(t('settings.profiles.invited.cancelFailed')))
          .finally(onChange)
    })
  }

  if (invitations.length === 0) return null
  return (
    <>
      <h2 className={styles.label}>{t('settings.profiles.groups.invited')}</h2>
      <ul className={styles.card}>
        {invitations.map(invitation => (
          <InvitedRow key={invitation.id} invitation={invitation} onRenew={renew} onCancel={cancel} />
        ))}
      </ul>
      <CodeDialog
        key={shown?.code ?? 'closed'}
        target={shown ? null : undefined}
        make={shown ? () => Promise.resolve(shown) : undefined}
        onClose={() => setShown(null)}
      />
    </>
  )
}

export default InvitedGroup
