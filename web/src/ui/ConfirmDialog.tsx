import { useTranslation } from 'react-i18next'
import { closeConfirmation, useConfirmation } from '../lib/confirm.ts'
import Button from './Button.tsx'
import styles from './ConfirmDialog.module.css'
import Dialog from './Dialog.tsx'
import DialogActions from './DialogActions.tsx'

// The question asked by askToConfirm, once for the app. Escape, the cross, "Annuler" or a click outside say no.
const ConfirmDialog = () => {
  const { t } = useTranslation()
  const confirmation = useConfirmation()

  const confirm = () => {
    confirmation?.onConfirm()
    closeConfirmation()
  }

  return (
    <Dialog
      open={confirmation !== null}
      onClose={closeConfirmation}
      title={confirmation?.title}
      describedBy="confirm-message"
    >
      {confirmation && (
        <>
          <p id="confirm-message" className={styles.message}>
            {confirmation.message}
          </p>
          <DialogActions>
            <Button onClick={closeConfirmation}>{t('common.cancel')}</Button>
            {/* Red, as every action that deletes or resets. */}
            <Button look="danger" onClick={confirm}>
              {confirmation.label}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}

export default ConfirmDialog
