import { ArrowRight, Terminal } from 'lucide-react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SETUP_CODE_LENGTH, SIGN_IN_CODE_CHARACTERS } from '../../api.ts'
import Button from '../../ui/Button.tsx'
import Notice from '../../ui/Notice.tsx'
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

// Where the setup code is, in a notice as wide as its boxes: read before typing, not hidden behind a "?".
const CodeNotice = () => {
  const { t } = useTranslation()
  return (
    <Notice icon={Terminal} title={t('setup.start.codeNoticeTitle')}>
      <p>
        <RichText i18nKey="setup.start.codeNoticeText" />
      </p>
    </Notice>
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
          <CodeNotice />
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
