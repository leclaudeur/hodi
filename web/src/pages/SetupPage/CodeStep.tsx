import { ArrowRight } from 'lucide-react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SETUP_CODE_LENGTH, SIGN_IN_CODE_CHARACTERS } from '../../api.ts'
import { useIsDesktop } from '../../lib/use-media.ts'
import Button from '../../ui/Button.tsx'
import HelpButton from '../../ui/HelpButton.tsx'
import PinField from '../../ui/PinField.tsx'
import RichText from '../../ui/RichText.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import styles from './Welcome.module.css'

interface CodeStepProps {
  codeRequired: boolean
  code: string
  codeWrong: boolean
  busy: boolean
  notice: string | null
  error: string | null
  onCode: (typed: string) => void
  onComplete: (typed: string) => void
  onSubmit: (event: FormEvent) => void
}

// Where the setup code is and why it is asked, beside the line under its boxes.
const CodeHelp = () => {
  const { t } = useTranslation()
  const desktop = useIsDesktop()
  return (
    <p className={styles.codeWhere}>
      {t('setup.start.codeWhere')}
      <HelpButton id="setup-code" title={t('setup.start.codeHelpTitle')} layout={desktop ? 'desktop' : 'phone'}>
        <p>{t('setup.start.codeHelpWhy')}</p>
        <p>
          {t('setup.start.codeHelpServer')} <code>docker compose logs app | grep "Setup code" | tail -1</code>.{' '}
          {t('setup.start.codeHelpLocal')}
        </p>
      </HelpButton>
    </p>
  )
}

// The welcome, as the landing page's hero on the same glows, with the setup code when the device is away from the
// server. The steps after it stand on cards over the same glows.
const CodeStep = (props: CodeStepProps) => {
  const { codeRequired, code, codeWrong, busy, notice, error, onCode, onComplete, onSubmit } = props
  const { t } = useTranslation()
  return (
    <form className={styles.welcome} onSubmit={onSubmit}>
      <span className={styles.kicker}>{t('setup.start.kicker')}</span>
      <h1 className={styles.title}>
        {t('setup.start.title')}
        <span className={styles.dot} aria-hidden="true" />
      </h1>
      <p className={styles.lead}>
        <RichText i18nKey="setup.start.lead" />
      </p>
      {codeRequired && (
        <div className={styles.code}>
          <PinField
            label={t('setup.start.code')}
            length={SETUP_CODE_LENGTH}
            characters={SIGN_IN_CODE_CHARACTERS}
            masked={false}
            autoFocus
            disabled={busy}
            state={codeWrong ? 'wrong' : 'idle'}
            value={code}
            onChange={onCode}
            onComplete={onComplete}
          />
          <CodeHelp />
        </div>
      )}
      {notice && !error && <StatusLine tone="info">{notice}</StatusLine>}
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <Button type="submit" look="primary" busy={busy} disabled={codeRequired && code.length !== SETUP_CODE_LENGTH}>
        {t('setup.start.button')}
        <ArrowRight size={16} aria-hidden="true" />
      </Button>
      <span className={styles.small}>{t('setup.start.length')}</span>
    </form>
  )
}

export default CodeStep
