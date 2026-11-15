import { Home, Plus, UserPlus, UserRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_HOUSEHOLD_NAME_LENGTH, MAX_PROFILE_NAME_LENGTH, createHouseholdFor, startHousehold } from '../../api.ts'
import { useLanguage } from '../../lib/i18n.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import EmptyState from '../../ui/EmptyState.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import TextField from '../../ui/TextField.tsx'
import householdStyles from '../household/Household.module.css'
import CodeDialog from '../profiles/CodeDialog.tsx'
import serverStyles from './Server.module.css'
import { load } from './server-people.ts'

// No household yet: « Créer mon foyer » brings back the setup's household steps; « Créer un foyer » makes one for
// someone else, whose admin profile waits for that person with a code.
const NoHousehold = () => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [other, setOther] = useState(false)
  const mine = async () => {
    setBusy(true)
    setError(false)
    try {
      await startHousehold()
      window.location.replace('#/household')
      window.location.reload()
    } catch {
      setError(true)
      setBusy(false)
    }
  }
  return (
    <>
      <EmptyState
        icon={<Home size={20} />}
        title={t('server.people.emptyTitle')}
        actions={
          <>
            <div className={serverStyles.createChoices}>
              <Button look="primary" icon={Plus} busy={busy} onClick={() => void mine()}>
                {t('server.people.createMine')}
              </Button>
              <Button icon={UserPlus} onClick={() => setOther(true)}>
                {t('server.people.createOther')}
              </Button>
            </div>
            {error && <StatusLine tone="error">{t('server.people.createFailed')}</StatusLine>}
          </>
        }
      >
        {t('server.people.emptyText')}
      </EmptyState>
      {other && <OtherHouseholdDialog onClose={() => setOther(false)} />}
    </>
  )
}

// « Créer un foyer » for someone else: its name and its admin's first name, then the code for that person.
const OtherHouseholdDialog = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const [name, setName] = useState('')
  const [admin, setAdmin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [made, setMade] = useState<{ profile: { id: number; name: string }; code: string } | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(false)
    try {
      setMade(await createHouseholdFor({ name: name.replace(/\s+/g, ' ').trim(), admin: admin.trim(), language }))
    } catch {
      setError(true)
      setBusy(false)
    }
  }

  // The household exists: the lists show it once the code is closed.
  if (made)
    return (
      <CodeDialog
        target={made.profile}
        onClose={() => {
          onClose()
          void load()
        }}
        make={() => Promise.resolve(made)}
      />
    )

  return (
    <Dialog open onClose={onClose} title={t('server.people.createOther')} intro={t('server.people.otherIntro')}>
      <form className={householdStyles.form} onSubmit={event => void submit(event)}>
        <label className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('setup.household.name')}</span>
          <TextField
            icon={Home}
            aria-label={t('setup.household.name')}
            placeholder={t('setup.household.namePlaceholder')}
            maxLength={MAX_HOUSEHOLD_NAME_LENGTH}
            autoFocus
            required
            value={name}
            onChange={event => setName(event.target.value)}
          />
        </label>
        <label className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('server.people.otherAdmin')}</span>
          <TextField
            icon={UserRound}
            aria-label={t('server.people.otherAdmin')}
            placeholder={t('server.people.otherAdminPlaceholder')}
            maxLength={MAX_PROFILE_NAME_LENGTH}
            required
            value={admin}
            onChange={event => setAdmin(event.target.value)}
          />
        </label>
        {error && <StatusLine tone="error">{t('server.people.createFailed')}</StatusLine>}
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" look="primary" busy={busy} disabled={!name.trim() || !admin.trim()}>
            {t('server.people.otherSubmit')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

export default NoHousehold
