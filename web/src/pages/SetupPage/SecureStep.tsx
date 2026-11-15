import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '../../ui/Button.tsx'
import RichText from '../../ui/RichText.tsx'
import { CodesStage, ScanStage, type useTwoFactorSetup } from '../../views/account/TwoFactorSetup.tsx'
import { Actions, StepHeader } from '../SetupParts.tsx'
import styles from '../SetupPage.module.css'

interface SecureStepProps {
  twoFactor: ReturnType<typeof useTwoFactorSetup>
  onContinue: () => void
}

// « Protège le compte », right after the server's account is made.
const SecureStep = ({ twoFactor, onContinue }: SecureStepProps) => {
  const { t } = useTranslation()
  const codes = twoFactor.stage === 'codes'
  return (
    <div className={styles.form}>
      <StepHeader
        title={t(codes ? 'twoFactor.codes.title' : 'twoFactor.setup.title')}
        intro={codes ? <RichText i18nKey="twoFactor.codes.intro" /> : t('twoFactor.setup.intro')}
        help={
          codes
            ? undefined
            : {
                id: 'setup-two-factor',
                title: t('twoFactor.setup.helpTitle'),
                body: <p>{t('twoFactor.setup.help')}</p>
              }
        }
      />
      {codes ? (
        <CodesStage codes={twoFactor.recoveryCodes ?? []} onKept={() => twoFactor.setKept(true)} />
      ) : (
        <ScanStage setup={twoFactor} />
      )}
      {codes && (
        <Actions>
          <Button look="primary" disabled={!twoFactor.kept} onClick={onContinue}>
            {t('common.continue')}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </Actions>
      )}
    </div>
  )
}

export default SecureStep
