import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Household, removeParentalCode, setParentalCode } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { hasNoPassword } from '../../../lib/two-factor.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import PinField from '../../../ui/PinField.tsx'
import RichText from '../../../ui/RichText.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

const CODE_LENGTH = 6

// Its six digits, shown while typed: a code the admin will give out reads better than dots. Saving then asks the
// admin's own password (and the app's code) on top of it, as a profile left open on a shared device does not prove who
// changes it.
const CodeDialog = ({ onClose, onSaved }: { onClose: () => void; onSaved: (next: Household) => void }) => {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const save = () => {
    if (code.length < CODE_LENGTH) return
    askToConfirm({
      title: t('confirm.parentalOn.title'),
      message: <RichText i18nKey="confirm.parentalOn.message" />,
      label: t('common.save'),
      look: 'primary',
      proof: hasNoPassword() ? { noPassword: true } : {},
      onConfirm: async proof => onSaved(await setParentalCode(code, proof))
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
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" look="primary" disabled={code.length < CODE_LENGTH}>
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
