import { Check, Copy, Download, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, confirmTwoFactor, startTwoFactor } from '../../api.ts'
import { showSaved } from '../../lib/toast.ts'
import { typesAtOnce, useIsPhone } from '../../lib/use-media.ts'
import Button from '../../ui/Button.tsx'
import PinField from '../../ui/PinField.tsx'
import QrCode from '../../ui/LazyQrCode.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import styles from './TwoFactorSetup.module.css'

export const TWO_FACTOR_CODE_LENGTH = 6

export type TwoFactorSecret = { secret: string; uri: string }

// The secret as the app would show it: groups of four, easier to type by hand.
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret

// « Validation en deux étapes », turned on: the app scans the QR (or the key is typed), its first code proves it, then
// the 10 recovery codes are shown once. The same steps in the setup (the server's admin) and in Compte et données.
// The caller draws the title of each stage and the buttons around it: stage says which one it is.
// started: the secret already asked for, after the password (Compte et données); without it, it is asked here.
export const useTwoFactorSetup = (active = true, started?: TwoFactorSecret) => {
  const [secret, setSecret] = useState<TwoFactorSecret | null>(started ?? null)
  const [failed, setFailed] = useState(false)
  const [code, setCode] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [kept, setKept] = useState(false)

  useEffect(() => {
    if (!active || started) return
    let cancelled = false
    startTwoFactor()
      .then(made => !cancelled && setSecret(made))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [active, started])

  const check = async (typed: string) => {
    setBusy(true)
    setWrong(false)
    try {
      setRecoveryCodes((await confirmTwoFactor(typed)).recoveryCodes)
    } catch (failure) {
      if (failure instanceof RequestError && failure.code === 'invalid_code') setWrong(true)
      else setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return {
    stage: recoveryCodes ? ('codes' as const) : ('scan' as const),
    secret,
    failed,
    code,
    setCode: (typed: string) => {
      setCode(typed)
      setWrong(false)
    },
    wrong,
    busy,
    check,
    recoveryCodes,
    kept,
    setKept
  }
}

export type TwoFactorSetupState = ReturnType<typeof useTwoFactorSetup>

// Without its spaces: an app takes the key pasted whole.
const copyKey = (secret: string, copied: string) =>
  navigator.clipboard.writeText(secret).then(
    () => showSaved(copied),
    () => {}
  )

// The QR, the key under it, and the field for the app's first code.
export const ScanStage = ({ setup }: { setup: TwoFactorSetupState }) => {
  const { t } = useTranslation()
  // On the phone itself, its camera cannot scan its own screen: the otpauth link opens the app instead.
  const phone = useIsPhone()
  if (setup.failed) return <StatusLine tone="error">{t('twoFactor.failed')}</StatusLine>
  return (
    <div className={styles.stage}>
      <ol className={styles.steps}>
        <li className={styles.step}>
          <span className={styles.number}>1</span>
          <span>{t('twoFactor.scan.app')}</span>
        </li>
        <li className={styles.step}>
          <span className={styles.number}>2</span>
          <span>{t(phone ? 'twoFactor.scan.link' : 'twoFactor.scan.qr')}</span>
        </li>
      </ol>
      <div className={styles.qrRow}>
        {phone ? (
          <Button icon={ExternalLink} href={setup.secret?.uri} disabled={!setup.secret}>
            {t('twoFactor.scan.open')}
          </Button>
        ) : setup.secret ? (
          <QrCode value={setup.secret.uri} label={t('twoFactor.scan.qrLabel')} size={136} />
        ) : (
          <span className={styles.qrWait} aria-hidden="true" />
        )}
        <div className={styles.key}>
          <span className={styles.keyLabel}>{t('twoFactor.scan.key')}</span>
          <div className={styles.keyRow}>
            <code className={styles.keyValue}>{setup.secret ? grouped(setup.secret.secret) : ''}</code>
            <button
              type="button"
              className={styles.copy}
              aria-label={t('twoFactor.scan.copyKey')}
              title={t('twoFactor.scan.copyKey')}
              disabled={!setup.secret}
              onClick={() => void copyKey(setup.secret?.secret ?? '', t('twoFactor.scan.keyCopied'))}
            >
              <Copy size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <ol className={styles.steps} start={3}>
        <li className={styles.step}>
          <span className={styles.number}>3</span>
          <span>{t('twoFactor.scan.type')}</span>
        </li>
      </ol>
      <PinField
        // Mounted again once the key is there: on a computer, the code is typed right away.
        key={setup.secret ? 'ready' : 'waiting'}
        autoFocus={Boolean(setup.secret) && typesAtOnce()}
        label={t('twoFactor.scan.code')}
        length={TWO_FACTOR_CODE_LENGTH}
        masked={false}
        align="start"
        disabled={setup.busy || !setup.secret}
        state={setup.wrong ? 'wrong' : 'idle'}
        value={setup.code}
        onChange={setup.setCode}
        onComplete={typed => void setup.check(typed)}
      />
      {setup.wrong && <StatusLine tone="error">{t('twoFactor.scan.wrong')}</StatusLine>}
    </div>
  )
}

// The 10 recovery codes, shown once: downloaded or copied before going on.
export const CodesStage = ({ codes, onKept }: { codes: string[]; onKept: () => void }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const text = `${t('twoFactor.codes.fileTitle')}\n\n${codes.join('\n')}\n`

  const download = () => {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    link.download = 'hodi-codes-de-secours.txt'
    link.click()
    URL.revokeObjectURL(link.href)
    onKept()
  }
  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      onKept()
      setCopied(true)
      showSaved(t('twoFactor.codes.copied'))
    })

  return (
    <div className={styles.stage}>
      <ul className={styles.codes} aria-label={t('twoFactor.codes.label')}>
        {codes.map(code => (
          <li key={code} className={styles.code}>
            {code}
          </li>
        ))}
      </ul>
      <div className={styles.keep}>
        <Button icon={Download} onClick={download}>
          {t('twoFactor.codes.download')}
        </Button>
        <Button icon={copied ? Check : Copy} onClick={copy}>
          {t('twoFactor.codes.copy')}
        </Button>
      </div>
    </div>
  )
}
