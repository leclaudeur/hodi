import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { refreshAiUsage, useAiAvailable, useAiCapped } from '../lib/ai-left.ts'
import { useCurrentProfile } from '../lib/profiles.ts'
import { showError } from '../lib/toast.ts'
import Button from '../ui/Button.tsx'
import SparkleIcon from '../ui/SparkleIcon.tsx'
import { usePluginId } from './scope.ts'

// Why a click got no answer: the household has no AI, its admin turned this plugin's off, a cap is reached, the AI
// declined, or the call or the plugin failed.
export type AiButtonError = 'unavailable' | 'off' | 'limited' | 'refused' | 'failed'

interface AiButtonProps {
  // The plugin's aiActions[action], which may ask ctx.ai one question.
  action: string
  // What the action receives as request.input: JSON, 16 KB at most.
  input?: unknown
  // What the action answered.
  onAnswer: (answer: unknown) => void
  // Told instead of the toast Hodi shows by default.
  onError?: (error: AiButtonError) => void
  children: ReactNode
  compact?: boolean
  wide?: boolean
  disabled?: boolean
}

const ERRORS: AiButtonError[] = ['unavailable', 'off', 'limited', 'refused', 'failed']

// The only way a plugin reaches the household's AI: Hodi's violet button, so a click is always a person's, on a button
// that looks like every other one that spends credits. Not shown to a young profile, nor without AI; turned off once
// the day's plugin cap is reached.
const AiButton = ({ action, input = null, onAnswer, onError, children, compact, wide, disabled }: AiButtonProps) => {
  const { t } = useTranslation()
  const id = usePluginId()
  const profile = useCurrentProfile()
  const available = useAiAvailable()
  const capped = useAiCapped('plugin')
  const [busy, setBusy] = useState(false)

  if (profile?.kind !== 'adult' || available === false) return null

  const fail = (error: AiButtonError) => {
    if (onError) onError(error)
    else showError(t(`plugins.aiButton.${error}`))
  }

  const click = async () => {
    setBusy(true)
    try {
      const response = await fetch(`/api/plugins/${encodeURIComponent(id)}/ai/${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input })
      })
      const body = (await response.json().catch(() => null)) as { answer?: unknown; error?: string } | null
      if (response.ok) onAnswer(body?.answer ?? null)
      else {
        const code = body?.error?.replace(/^ai_/, '') as AiButtonError | undefined
        fail(code && ERRORS.includes(code) ? code : 'failed')
      }
    } catch {
      fail('failed')
    } finally {
      setBusy(false)
      void refreshAiUsage()
    }
  }

  return (
    <Button
      look="ai"
      icon={SparkleIcon}
      busy={busy}
      compact={compact}
      wide={wide}
      disabled={disabled || capped}
      title={capped ? t('plugins.aiButton.limited') : undefined}
      onClick={() => void click()}
    >
      {children}
    </Button>
  )
}

export default AiButton
