import { ArrowRight, House } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, startTwoFactor } from '../../api.ts'
import { FRONT_PAGE_HREF } from '../../lib/use-hash-route.ts'
import { isServerOnly } from '../../lib/server-only.ts'
import { setTwoFactorOn } from '../../lib/two-factor.ts'
import { Actions, SetupFrame, StepHeader } from '../../pages/SetupParts.tsx'
import styles from '../../pages/SetupPage.module.css'
import Button from '../../ui/Button.tsx'
import PasswordField from '../../ui/PasswordField.tsx'
import RichText from '../../ui/RichText.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import householdStyles from '../household/Household.module.css'
import { CodesStage, ScanStage, type TwoFactorSecret, useTwoFactorSetup } from '../account/TwoFactorSetup.tsx'

// The server's admin without « Validation en deux étapes » (an install from before it, or a setup left before that
// step): /server opens once it is on. Its password first, then the app's QR and the recovery codes, as at the setup.
const ServerTwoFactor = () => {
  const { t } = useTranslation()
  const [started, setStarted] = useState<TwoFactorSecret | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setStarted(await startTwoFactor(password))
    } catch (failure) {
      setError(
        failure instanceof RequestError && failure.code === 'invalid_password'
          ? t('settings.account.wrongPassword')
          : t('twoFactor.failed')
      )
      setBusy(false)
    }
  }

  const help = {
    id: 'server-two-factor',
    title: t('twoFactor.setup.helpTitle'),
    body: <p>{t('twoFactor.setup.help')}</p>
  }

  if (!started)
    return (
      <SetupFrame>
        <form className={styles.form} onSubmit={event => void start(event)}>
          <StepHeader title={t('twoFactor.setup.title')} intro={t('twoFactor.server.intro')} help={help} />
          <div className={householdStyles.field}>
            <span className={householdStyles.fieldLabel}>{t('settings.account.yourPassword')}</span>
            <PasswordField
              aria-label={t('settings.account.yourPassword')}
              autoComplete="current-password"
              autoFocus
              required
              invalid={error !== null}
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </div>
          {error && <StatusLine tone="error">{error}</StatusLine>}
          {/* With no household, the app is /server alone: nowhere to go back to. */}
          <Actions
            start={
              isServerOnly() ? undefined : (
                <Button icon={House} href={FRONT_PAGE_HREF}>
                  {t('twoFactor.server.back')}
                </Button>
              )
            }
          >
            <Button type="submit" look="primary" busy={busy} disabled={!password}>
              {t('common.continue')}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </Actions>
        </form>
      </SetupFrame>
    )
  return <Scan started={started} help={help} />
}

const Scan = ({
  started,
  help
}: {
  started: TwoFactorSecret
  help: { id: string; title: string; body: ReactNode }
}) => {
  const { t } = useTranslation()
  const setup = useTwoFactorSetup(true, started)
  const codes = setup.stage === 'codes'
  return (
    <SetupFrame>
      <div className={styles.form}>
        <StepHeader
          title={t(codes ? 'twoFactor.codes.title' : 'twoFactor.setup.title')}
          intro={codes ? <RichText i18nKey="twoFactor.codes.intro" /> : t('twoFactor.setup.intro')}
          help={codes ? undefined : help}
        />
        {codes ? (
          <CodesStage codes={setup.recoveryCodes ?? []} onKept={() => setup.setKept(true)} />
        ) : (
          <ScanStage setup={setup} />
        )}
        {codes && (
          <Actions>
            <Button look="primary" disabled={!setup.kept} onClick={() => setTwoFactorOn(true)}>
              {t('common.continue')}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </Actions>
        )}
      </div>
    </SetupFrame>
  )
}

export default ServerTwoFactor
