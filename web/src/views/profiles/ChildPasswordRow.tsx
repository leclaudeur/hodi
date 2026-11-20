import { KeyRound } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ChildAccount, getChildren, setChildPassword } from '../../api.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import NewPasswordFields from '../../ui/NewPasswordFields.tsx'
import SettingRow from '../settings/SettingRow.tsx'

// The young one's account, when the parent looking runs it; null while it loads or when it is not one of theirs.
export const useChildAccount = (profileId: number) => {
  const [child, setChild] = useState<ChildAccount | null>(null)
  useEffect(() => {
    let cancelled = false
    getChildren()
      .then(({ children }) => {
        if (!cancelled) setChild(children.find(entry => entry.profileId === profileId) ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [profileId])
  return [child, setChild] as const
}

// A young one's card › Appareils: the password it signs in with, with its @identifier, which only its parents choose.
const ChildPasswordRow = ({ profileId }: { profileId: number }) => {
  const { t } = useTranslation()
  const [child, setChild] = useChildAccount(profileId)
  const [editing, setEditing] = useState(false)
  if (!child) return null
  return (
    <>
      <SettingRow
        label={t('children.password.label')}
        hint={
          child.hasPassword
            ? t('children.password.hint', { handle: child.handle ?? '' })
            : t('children.password.none', { handle: child.handle ?? '' })
        }
        action={{
          label: t(child.hasPassword ? 'children.password.change' : 'children.password.choose'),
          ariaLabel: t('children.password.actionLabel', { name: child.name }),
          icon: KeyRound,
          onClick: () => setEditing(true)
        }}
      />
      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={t('children.password.title', { name: child.name })}
        intro={t('children.password.intro', { handle: child.handle ?? '' })}
      >
        {editing && (
          <PasswordForm
            child={child}
            onCancel={() => setEditing(false)}
            onSaved={next => {
              setChild(next)
              setEditing(false)
            }}
          />
        )}
      </Dialog>
    </>
  )
}

interface PasswordFormProps {
  child: ChildAccount
  onCancel: () => void
  onSaved: (child: ChildAccount) => void
}

// The new one twice, then the parent's own password: its devices signed in with the old one sign in again.
const PasswordForm = ({ child, onCancel, onSaved }: PasswordFormProps) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password === '' || password !== again) return
    askToConfirm({
      title: t('children.password.confirmTitle', { name: child.name }),
      message: t('children.password.confirmText'),
      label: t('common.save'),
      look: 'primary',
      proof: {},
      onConfirm: async proof => {
        onSaved(await setChildPassword(child.accountId, password, proof))
        showSaved(t('children.password.saved', { name: child.name }))
      }
    })
  }
  return (
    <form onSubmit={submit}>
      <NewPasswordFields password={password} confirm={again} onPassword={setPassword} onConfirm={setAgain} autoFocus />
      <DialogActions>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" look="primary" disabled={password === '' || password !== again}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </form>
  )
}

export default ChildPasswordRow
