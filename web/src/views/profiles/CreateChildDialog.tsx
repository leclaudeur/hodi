import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ChildAccount, PROFILE_COLORS, type ProfileColor, createChild, uploadProfilePhoto } from '../../api.ts'
import { refreshProfiles } from '../../lib/profiles.ts'
import { RequestError } from '../../api/http.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import NewPasswordFields from '../../ui/NewPasswordFields.tsx'
import householdStyles from '../household/Household.module.css'
import ProfileForm, { type ProfileDraft } from './ProfileForm.tsx'

interface CreateChildProps {
  open: boolean
  // The colours its brothers and sisters have: a new one starts with another.
  taken: ProfileColor[]
  onClose: () => void
  onCreated: (child: ChildAccount) => void
}

// Mon compte › Mes enfants › « Créer un compte »: who it is (ado or enfant, name, @identifier, colour), then the
// password its parent chooses. Its sources and hours are set on its card afterwards.
const CreateChildDialog = ({ open, taken, onClose, onCreated }: CreateChildProps) => {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const close = () => {
    setDraft(null)
    onClose()
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title={draft ? t('children.create.passwordTitle', { name: draft.name }) : t('children.create.title')}
    >
      {open && !draft && (
        <ProfileForm
          defaultColor={PROFILE_COLORS.find(color => !taken.includes(color))}
          kinds={['teen', 'child']}
          withHandle={{}}
          submitLabel={t('common.continue')}
          onCancel={close}
          onSave={async next => setDraft(next)}
        />
      )}
      {open && draft && (
        <PasswordStep
          draft={draft}
          onBack={() => setDraft(null)}
          onCreated={child => {
            setDraft(null)
            onCreated(child)
          }}
        />
      )}
    </Dialog>
  )
}

interface PasswordStepProps {
  draft: ProfileDraft
  onBack: () => void
  onCreated: (child: ChildAccount) => void
}

const PasswordStep = ({ draft, onBack, onCreated }: PasswordStepProps) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== again) return
    setBusy(true)
    setError(null)
    try {
      const child = await createChild({
        kind: draft.kind === 'child' ? 'child' : 'teen',
        name: draft.name,
        color: draft.color,
        avatar: draft.avatar,
        handle: draft.handle,
        password
      })
      if (draft.photo && child.kind !== 'child') await uploadProfilePhoto(child.profileId, draft.photo).catch(() => {})
      void refreshProfiles().catch(() => {})
      onCreated(child)
    } catch (failure) {
      const taken = failure instanceof RequestError && failure.code === 'handle_taken'
      setError(t(taken ? 'children.create.handleTaken' : 'children.create.failed'))
      setBusy(false)
    }
  }

  return (
    <form className={householdStyles.form} onSubmit={submit}>
      <NewPasswordFields password={password} confirm={again} onPassword={setPassword} onConfirm={setAgain} autoFocus />
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <DialogActions>
        <Button onClick={onBack}>{t('common.back')}</Button>
        <Button type="submit" look="primary" busy={busy} disabled={password === '' || password !== again}>
          {t('children.create.button')}
        </Button>
      </DialogActions>
    </form>
  )
}

export default CreateChildDialog
