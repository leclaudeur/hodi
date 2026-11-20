import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AccountView, removeParentalCode, setParentalCode } from '../../api.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { hasNoPassword } from '../../lib/two-factor.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import PinField from '../../ui/PinField.tsx'
import RichText from '../../ui/RichText.tsx'
import Toggle from '../../ui/Toggle.tsx'
import SettingRow from '../../views/settings/SettingRow.tsx'
import styles from '../../views/settings/Settings.module.css'

const CODE_LENGTH = 6

// Its six digits, shown while typed: the parent checks what they chose. Saving then asks their own password (and the
// app's code) on top of it, as a profile left open on a shared tablet does not prove who changes it.
const CodeDialog = ({ onClose, onSaved }: { onClose: () => void; onSaved: (next: AccountView) => void }) => {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const save = () => {
    if (code.length < CODE_LENGTH) return
    askToConfirm({
      title: t('children.parentalCode.onTitle'),
      message: <RichText i18nKey="children.parentalCode.onText" />,
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
      title={t('children.parentalCode.dialogTitle')}
      intro={<RichText i18nKey="children.parentalCode.dialogIntro" />}
    >
      <form
        onSubmit={event => {
          event.preventDefault()
          save()
        }}
      >
        <PinField
          label={t('children.parentalCode.newCode')}
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

const hintKey = (on: boolean, parent: boolean) => {
  if (on) return 'children.parentalCode.hintOn'
  return parent ? 'children.parentalCode.hintAdvised' : 'children.parentalCode.hintOff'
}

interface ParentalCodeCardProps {
  account: AccountView
  onAccount: (next: AccountView) => void
  // A parent is advised to choose one; any other adult may.
  parent: boolean
}

// Mes enfants › Code parental, the adult's own: once on, their profile asks for it in « Qui lit ? » on a device where a
// teen or a child is signed in. Off, a parent's row says it is advised, until they choose one.
const ParentalCodeCard = ({ account, onAccount, parent }: ParentalCodeCardProps) => {
  const { t } = useTranslation()
  const on = account.parentalCode ?? false
  const [choosing, setChoosing] = useState(false)
  return (
    <>
      <h2 className={styles.label}>{t('children.parentalCode.section')}</h2>
      <div className={styles.card}>
        <SettingRow label={t('children.parentalCode.title')} hint={t(hintKey(on, parent))}>
          <Toggle
            label={t('children.parentalCode.title')}
            checked={on}
            onChange={next =>
              next
                ? setChoosing(true)
                : askToConfirm({
                    title: t('children.parentalCode.offTitle'),
                    message: <RichText i18nKey="children.parentalCode.offText" />,
                    label: t('children.parentalCode.off'),
                    proof: hasNoPassword() ? { noPassword: true } : {},
                    onConfirm: async proof => onAccount(await removeParentalCode(proof))
                  })
            }
          />
        </SettingRow>
        {on && (
          <SettingRow
            label={t('children.parentalCode.code')}
            value={t('children.parentalCode.codeValue')}
            action={{
              label: t('common.change'),
              ariaLabel: t('children.parentalCode.changeLabel'),
              icon: KeyRound,
              onClick: () => setChoosing(true)
            }}
          />
        )}
      </div>
      {choosing && (
        <CodeDialog
          onClose={() => setChoosing(false)}
          onSaved={next => {
            setChoosing(false)
            onAccount(next)
          }}
        />
      )}
    </>
  )
}

export default ParentalCodeCard
