import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Household, removeParentalCode, setParentalCode } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { hasNoPassword, useTwoFactorOn } from '../../../lib/two-factor.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import PinField from '../../../ui/PinField.tsx'
import ProofFields, { type ProofError, proofErrorOf } from '../../../ui/ProofFields.tsx'
import RichText from '../../../ui/RichText.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SettingRow from '../SettingRow.tsx'
import householdStyles from '../../household/Household.module.css'
import styles from '../Settings.module.css'

const CODE_LENGTH = 6

// Its six digits, shown while typed: a code the admin will give out reads better than dots. Then the admin's own
// password (and the app's code), as a profile left open on a shared device does not prove who changes it.
const CodeDialog = ({ onClose, onSaved }: { onClose: () => void; onSaved: (next: Household) => void }) => {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [appCode, setAppCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ProofError | null>(null)
  const askPassword = !hasNoPassword()
  const askCode = useTwoFactorOn()
  const ready = code.length === CODE_LENGTH && (!askPassword || password !== '') && (!askCode || appCode.length === 6)
  const save = () => {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    setParentalCode(code, { password, code: appCode }).then(onSaved, (failure: unknown) => {
      setSaving(false)
      setError(proofErrorOf(failure))
    })
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('settings.household.codeTitle')}
      intro={<RichText i18nKey="settings.household.codeIntro" />}
    >
      <form
        className={householdStyles.form}
        onSubmit={event => {
          event.preventDefault()
          save()
        }}
      >
        <PinField
          label={t('settings.household.newCode')}
          length={CODE_LENGTH}
          align="start"
          masked={false}
          autoFocus
          value={code}
          onChange={setCode}
        />
        <ProofFields
          askPassword={askPassword}
          askCode={askCode}
          autoFocus={false}
          error={error}
          password={password}
          code={appCode}
          onPassword={setPassword}
          onCode={setAppCode}
        />
        {error && <StatusLine tone="error">{t(`confirm.proof.${error}`)}</StatusLine>}
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" look="primary" busy={saving} disabled={!ready}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// « Code parental », the admin's: once on, every adult profile that is not private asks for it in « Qui lit ? ».
const ParentalCodeCard = ({ household, onSaved }: { household: Household; onSaved: (next: Household) => void }) => {
  const { t } = useTranslation()
  const on = household.parentalCode ?? false
  const [choosing, setChoosing] = useState(false)
  return (
    <>
      <h2 className={styles.label}>{t('settings.household.adults')}</h2>
      <div className={styles.card}>
        <SettingRow label={t('settings.household.parentalCode')} hint={t('settings.household.parentalCodeHint')}>
          <Toggle
            label={t('settings.household.parentalCode')}
            checked={on}
            onChange={next =>
              next
                ? setChoosing(true)
                : askToConfirm({
                    title: t('confirm.parentalOff.title'),
                    message: <RichText i18nKey="confirm.parentalOff.message" />,
                    label: t('confirm.parentalOff.button'),
                    proof: hasNoPassword() ? { noPassword: true } : {},
                    onConfirm: async proof => onSaved(await removeParentalCode(proof))
                  })
            }
          />
        </SettingRow>
        {on && (
          <SettingRow
            label={t('settings.household.code')}
            value={t('settings.household.codeValue')}
            action={{ label: t('common.change'), icon: KeyRound, onClick: () => setChoosing(true) }}
          />
        )}
      </div>
      {choosing && (
        <CodeDialog
          onClose={() => setChoosing(false)}
          onSaved={next => {
            setChoosing(false)
            onSaved(next)
          }}
        />
      )}
    </>
  )
}

export default ParentalCodeCard
