import { Globe, House, Pencil } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ServerGeneral as General, getServerGeneral, setServerGeneral } from '../../api.ts'
import { RequestError } from '../../api/http.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import TextField from '../../ui/TextField.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import youngStyles from '../settings/sections/young/Young.module.css'

type AddressKey = keyof General

const ICONS = { appUrl: Globe, publicHome: House }

interface AddressDialogProps {
  name: AddressKey
  current: string | null
  onClose: () => void
  onSaved: (general: General) => void
}

// One address, or nothing: the server checks it and says when it is not one.
const AddressDialog = ({ name, current, onClose, onSaved }: AddressDialogProps) => {
  const { t } = useTranslation()
  // Hodi's address starts as the one this page is open at, the usual answer.
  const [value, setValue] = useState(current ?? (name === 'appUrl' ? window.location.origin : ''))
  const [invalid, setInvalid] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      onSaved(await setServerGeneral({ [name]: value.trim() || null }))
      showSaved(t('server.general.saved'))
      onClose()
    } catch (error) {
      if (error instanceof RequestError && error.code === 'invalid_url') setInvalid(true)
      else showError(t('server.general.failed'))
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={t(`server.general.${name}.label`)} intro={t(`server.general.${name}.intro`)}>
      <form className={youngStyles.form} onSubmit={submit}>
        <TextField
          icon={ICONS[name]}
          inputMode="url"
          aria-label={t(`server.general.${name}.field`)}
          placeholder={t(`server.general.${name}.placeholder`)}
          maxLength={200}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          aria-invalid={invalid}
          onChange={event => {
            setValue(event.target.value)
            setInvalid(false)
          }}
        />
        {invalid && <StatusLine tone="error">{t('server.general.invalid')}</StatusLine>}
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" look="primary" busy={saving} disabled={value.trim() === (current ?? '')}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// Serveur › Général: Hodi's own address, for the links of its e-mails, and the public site a first visit goes to.
const ServerGeneral = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const [general, setGeneral] = useState<General | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<AddressKey | null>(null)

  useEffect(() => {
    getServerGeneral()
      .then(setGeneral)
      .catch(() => setFailed(true))
  }, [])

  const row = (name: AddressKey) => (
    <SettingRow
      label={t(`server.general.${name}.label`)}
      value={general?.[name] ?? undefined}
      hint={general?.[name] ? undefined : t(`server.general.${name}.none`)}
      action={{ label: t('common.change'), icon: Pencil, onClick: () => setEditing(name) }}
    />
  )

  return (
    <SectionPage title={t('server.titles.general')} intro={t('server.general.intro')} layout={layout}>
      {failed && <StatusLine tone="error">{t('server.general.loadFailed')}</StatusLine>}
      {general && (
        <>
          <h2 className={styles.label}>{t('server.general.addresses')}</h2>
          <div className={styles.card}>
            {row('appUrl')}
            {row('publicHome')}
          </div>
          {editing && (
            <AddressDialog
              name={editing}
              current={general[editing]}
              onClose={() => setEditing(null)}
              onSaved={setGeneral}
            />
          )}
        </>
      )}
    </SectionPage>
  )
}

export default ServerGeneral
