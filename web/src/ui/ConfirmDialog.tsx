import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Confirmation, cancelConfirmation, closeConfirmation, useConfirmation } from '../lib/confirm.ts'
import { useTwoFactorOn } from '../lib/two-factor.ts'
import Button from './Button.tsx'
import styles from './ConfirmDialog.module.css'
import Dialog from './Dialog.tsx'
import DialogActions from './DialogActions.tsx'
import ProofFields, { type ProofError, proofErrorOf } from './ProofFields.tsx'
import StatusLine from './StatusLine.tsx'

// The question asked by askToConfirm, once for the app. Escape, the cross, "Annuler" or a click outside say no.
const ConfirmDialog = () => {
  const confirmation = useConfirmation()
  return (
    <Dialog
      open={confirmation !== null}
      onClose={cancelConfirmation}
      title={confirmation?.title}
      describedBy="confirm-message"
    >
      {/* Remade for each question: nothing typed for the last one stays. */}
      {confirmation && <Question key={confirmation.title} confirmation={confirmation} />}
    </Dialog>
  )
}

const Question = ({ confirmation }: { confirmation: Confirmation }) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ProofError | null>(null)
  const { proof } = confirmation
  const twoFactor = useTwoFactorOn()
  const askPassword = proof !== undefined && proof.noPassword !== true && proof.codeOnly !== true
  const askCode = proof !== undefined && (twoFactor || proof.codeOnly === true)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!proof) {
      void confirmation.onConfirm({ password: '', code: '' })
      closeConfirmation()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await confirmation.onConfirm({ password, code })
      closeConfirmation()
    } catch (failure) {
      setError(proofErrorOf(failure))
      setBusy(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={event => void submit(event)}>
      <p id="confirm-message" className={styles.message}>
        {confirmation.message}
      </p>
      {proof && (
        <ProofFields
          askPassword={askPassword}
          askCode={askCode}
          error={error}
          password={password}
          code={code}
          onPassword={setPassword}
          onCode={typed => {
            setCode(typed)
            if (error === 'wrongCode') setError(null)
          }}
        />
      )}
      {error && <StatusLine tone="error">{t(`confirm.proof.${error}`)}</StatusLine>}
      <DialogActions>
        <Button type="button" onClick={cancelConfirmation}>
          {t('common.cancel')}
        </Button>
        {/* Red, as every action that deletes or resets. */}
        <Button
          type="submit"
          look={confirmation.look ?? 'danger'}
          busy={busy}
          disabled={(askPassword && !password) || (askCode && code.length !== 6)}
        >
          {confirmation.label}
        </Button>
      </DialogActions>
    </form>
  )
}

export default ConfirmDialog
