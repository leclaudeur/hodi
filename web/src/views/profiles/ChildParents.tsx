import { AtSign, UserMinus, UserPlus, X } from 'lucide-react'
import type { TFunction } from 'i18next'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type ChildAccount,
  type ChildParent,
  cancelParentInvitation,
  inviteParent,
  stopBeingParent
} from '../../api.ts'
import { RequestError } from '../../api/http.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import { numericDate } from '../../lib/format.ts'
import { accountHref } from '../../lib/use-hash-route.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import RichText from '../../ui/RichText.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import TextField from '../../ui/TextField.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import profileStyles from './Profiles.module.css'
import householdStyles from '../household/Household.module.css'
import { useChildAccount } from './ChildPasswordRow.tsx'

// Two parents at most: the one who made the account, and the one they invite.
const MAX_PARENTS = 2

interface ChildParentsProps {
  profileId: number
}

// « @anthony · depuis le 20.11.2026 »: who each one is, rather than « Toi ».
const parentHint = (parent: ChildParent, t: TFunction) => {
  const since = t('children.parents.since', { date: numericDate(new Date(parent.since).toISOString()) })
  return parent.handle ? `@${parent.handle} · ${since}` : since
}

// A young one's card › Parents: its parents with the same rights, the one invited while it has not answered, and
// « Inviter un second parent » under the list. Neither parent takes the other off; each may step back, never the last.
const ChildParents = ({ profileId }: ChildParentsProps) => {
  const { t } = useTranslation()
  const [child, setChild] = useChildAccount(profileId)
  const [inviting, setInviting] = useState(false)
  if (!child) return null
  const alone = child.parents.length < MAX_PARENTS
  const cancel = () =>
    void cancelParentInvitation(child.accountId)
      .then(setChild)
      .catch(() => showError(t('children.parents.failed')))
  return (
    <>
      <h2 className={styles.label}>{t('children.parents.title')}</h2>
      <div className={styles.card}>
        {child.parents.map(parent => (
          <SettingRow
            key={parent.accountId}
            label={parent.you ? t('children.parents.youName', { name: parent.name }) : parent.name}
            hint={parentHint(parent, t)}
            action={
              parent.you && !alone
                ? {
                    label: t('children.parents.leave'),
                    ariaLabel: t('children.parents.leaveLabel', { name: child.name }),
                    look: 'danger',
                    icon: UserMinus,
                    onClick: () => confirmLeave(child, t)
                  }
                : undefined
            }
          />
        ))}
        {child.invited && (
          <SettingRow
            label={child.invited.name}
            hint={
              child.invited.handle
                ? `@${child.invited.handle} · ${t('children.parents.waiting')}`
                : t('children.parents.waiting')
            }
            action={{
              label: t('children.parents.cancel'),
              ariaLabel: t('children.parents.cancelLabel', { name: child.invited.name }),
              icon: X,
              onClick: cancel
            }}
          />
        )}
      </div>
      {alone && !child.invited && (
        <div className={profileStyles.actions}>
          <Button icon={UserPlus} onClick={() => setInviting(true)}>
            {t('children.parents.second')}
          </Button>
        </div>
      )}
      <Dialog
        open={inviting}
        onClose={() => setInviting(false)}
        title={t('children.parents.inviteTitle')}
        intro={t('children.parents.inviteIntro', { name: child.name })}
      >
        {inviting && (
          <InviteForm
            child={child}
            onCancel={() => setInviting(false)}
            onSent={next => {
              setChild(next)
              setInviting(false)
              showSaved(t('children.parents.sent', { name: next.invited?.name ?? '' }))
            }}
          />
        )}
      </Dialog>
    </>
  )
}

// « Ne plus être parent », after the parent's own password: the other one keeps everything.
const confirmLeave = (child: ChildAccount, t: TFunction) =>
  askToConfirm({
    title: t('children.parents.leaveTitle', { name: child.name }),
    message: <RichText i18nKey="children.parents.leaveText" values={{ name: child.name }} />,
    label: t('children.parents.leave'),
    proof: {},
    onConfirm: async proof => {
      await stopBeingParent(child.accountId, proof)
      showSaved(t('children.parents.left', { name: child.name }))
      window.location.hash = accountHref('children')
    }
  })

const ERRORS: Record<string, string> = {
  unknown_handle: 'children.parents.unknown',
  already_parent: 'children.parents.already',
  parents_full: 'children.parents.full',
  too_many_requests: 'children.parents.tooMany'
}

interface InviteFormProps {
  child: ChildAccount
  onCancel: () => void
  onSent: (child: ChildAccount) => void
}

const InviteForm = ({ child, onCancel, onSent }: InviteFormProps) => {
  const { t } = useTranslation()
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSent(await inviteParent(child.accountId, handle.trim()))
    } catch (failure) {
      const code = failure instanceof RequestError ? failure.code : null
      setError(ERRORS[code ?? ''] ?? 'children.parents.failed')
      setBusy(false)
    }
  }
  return (
    <form className={householdStyles.form} onSubmit={submit}>
      <TextField
        icon={AtSign}
        aria-label={t('children.parents.handle')}
        placeholder={t('children.parents.handlePlaceholder')}
        value={handle}
        aria-invalid={error !== null}
        onChange={event => {
          setHandle(event.target.value)
          setError(null)
        }}
        autoCapitalize="none"
        autoComplete="off"
        autoFocus
      />
      {error && <StatusLine tone="error">{t(error as 'children.parents.failed')}</StatusLine>}
      <DialogActions>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" look="primary" busy={busy} disabled={handle.trim() === ''}>
          {t('children.parents.send')}
        </Button>
      </DialogActions>
    </form>
  )
}

export default ChildParents
