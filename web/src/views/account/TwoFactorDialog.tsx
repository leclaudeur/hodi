import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import RichText from '../../ui/RichText.tsx'
import { CodesStage, ScanStage, type TwoFactorSecret, useTwoFactorSetup } from './TwoFactorSetup.tsx'

// Compte et données › « Activer », once the password was typed: the app's QR and first code, then the recovery codes,
// in one dialog.
const TwoFactorDialog = ({
  started,
  onClose,
  onDone
}: {
  started: TwoFactorSecret
  onClose: () => void
  onDone: () => void
}) => {
  const { t } = useTranslation()
  const setup = useTwoFactorSetup(true, started)
  const codes = setup.stage === 'codes'
  return (
    <Dialog
      open
      // Once on, the codes are shown once: closing goes through « Je les ai gardés ».
      onClose={codes ? () => undefined : onClose}
      title={t(codes ? 'twoFactor.codes.title' : 'twoFactor.account.dialogTitle')}
      intro={codes ? <RichText i18nKey="twoFactor.codes.intro" /> : t('twoFactor.account.dialogIntro')}
    >
      {codes ? (
        <CodesStage codes={setup.recoveryCodes ?? []} onKept={() => setup.setKept(true)} />
      ) : (
        <ScanStage setup={setup} />
      )}
      <DialogActions>
        {codes ? (
          <Button look="primary" disabled={!setup.kept} onClick={onDone}>
            {t('twoFactor.codes.done')}
          </Button>
        ) : (
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

// « Nouveaux codes de secours »: the 10 new ones, shown once, as when it was turned on.
export const RecoveryCodesDialog = ({ codes, onDone }: { codes: string[]; onDone: () => void }) => {
  const { t } = useTranslation()
  const [kept, setKept] = useState(false)
  return (
    <Dialog
      open
      onClose={() => undefined}
      title={t('twoFactor.codes.title')}
      intro={<RichText i18nKey="twoFactor.codes.intro" />}
    >
      <CodesStage codes={codes} onKept={() => setKept(true)} />
      <DialogActions>
        <Button look="primary" disabled={!kept} onClick={onDone}>
          {t('twoFactor.codes.done')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default TwoFactorDialog
