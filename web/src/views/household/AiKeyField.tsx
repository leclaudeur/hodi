import { ExternalLink, KeyRound, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AiProviderInfo, type KeyCheck, RequestError, UnauthorizedError } from '../../api.ts'
import Button from '../../ui/Button.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import TextField from '../../ui/TextField.tsx'
import styles from './Household.module.css'

const TONES: Record<KeyCheck, 'info' | 'error'> = { ok: 'info', invalid: 'error', unreachable: 'error' }

interface AiKeyFieldProps {
  provider: AiProviderInfo
  value: string
  onChange: (key: string) => void
  // The last check of this key, null until "Vérifier".
  result: KeyCheck | null
  onResult: (result: KeyCheck | null) => void
  // Asks the provider, which costs no credits: on the click only.
  check: (provider: string, key: string) => Promise<KeyCheck>
  onUnauthorized?: () => void
}

// An AI's key: pasted, then checked on a click, with where to make one.
const AiKeyField = ({ provider, value, onChange, result, onResult, check, onUnauthorized }: AiKeyFieldProps) => {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)

  const verify = async () => {
    setChecking(true)
    setFailed(false)
    try {
      onResult(await check(provider.id, value.trim()))
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized?.()
      else if (error instanceof RequestError && error.code === 'too_many_attempts') onResult('unreachable')
      else setFailed(true)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className={styles.keyField}>
      <span className={styles.fieldLabel}>{t('aiKey.label', { provider: provider.name })}</span>
      <div className={styles.fieldRow}>
        <TextField
          icon={KeyRound}
          aria-label={t('aiKey.label', { provider: provider.name })}
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={event => {
            onChange(event.target.value)
            onResult(null)
          }}
        />
        <Button icon={ShieldCheck} busy={checking} disabled={!value.trim()} onClick={() => void verify()}>
          {t('aiKey.check')}
        </Button>
      </div>
      {failed ? (
        <StatusLine tone="error">{t('aiKey.failed')}</StatusLine>
      ) : (
        result && <StatusLine tone={TONES[result]}>{t(`aiKey.${result}`)}</StatusLine>
      )}
      <a className={styles.keysLink} href={provider.keysUrl} target="_blank" rel="noopener noreferrer">
        {t('aiKey.console', { provider: provider.name.replace(/ \(.*\)$/, '') })}
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  )
}

export default AiKeyField
