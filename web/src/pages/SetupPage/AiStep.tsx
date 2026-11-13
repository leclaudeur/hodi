import { ArrowRight, Check, CircleSlash, MapPin } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AiProviderInfo, KeyCheck } from '../../api.ts'
import { countryName } from '../../lib/regions.ts'
import Button from '../../ui/Button.tsx'
import SparkleIcon from '../../ui/SparkleIcon.tsx'
import AiKeyField from '../../views/household/AiKeyField.tsx'
import { CountryPicker } from '../../views/household/RegionPickers.tsx'
import SettingRow from '../../views/settings/SettingRow.tsx'
import settingsStyles from '../../views/settings/Settings.module.css'
import { Actions, StepHeader } from '../SetupParts.tsx'
import styles from '../SetupPage.module.css'

export const NO_AI = 'none'

interface AiStepProps {
  step: number
  total: number
  providers: AiProviderInfo[]
  ai: string
  onAi: (id: string) => void
  // The chosen provider; null for none.
  provider: AiProviderInfo | null
  aiKey: string
  onAiKey: (value: string) => void
  keyCheck: KeyCheck | null
  onKeyCheck: (result: KeyCheck | null) => void
  checkKey: (provider: string, key: string) => Promise<KeyCheck>
  country: string | null
  onCountry: (country: string | null) => void
  onNext: () => void
  onBack: () => void
}

// The chosen card's mark, as the worn badge in the profile sheet: a filled round over its top-right corner.
const ChoiceCheck = ({ checked }: { checked: boolean }) =>
  checked && (
    <span className={styles.choiceCheck} aria-hidden="true">
      <Check size={12} strokeWidth={3} />
    </span>
  )

// The providers the server knows, then none.
const AiChoices = ({ providers, ai, onAi }: Pick<AiStepProps, 'providers' | 'ai' | 'onAi'>) => {
  const { t } = useTranslation()
  return (
    <div className={styles.choices} role="radiogroup" aria-label={t('setup.ai.label')}>
      {providers.map(option => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={ai === option.id}
          className={`${styles.choice} ${styles.aiChoice}`}
          onClick={() => onAi(option.id)}
        >
          <span className={styles.choiceMark}>
            <SparkleIcon size={18} />
          </span>
          <span className={styles.choiceText}>
            <span className={styles.choiceLabel}>{option.name}</span>
            <span className={styles.choiceHint}>{t('setup.ai.providerHint')}</span>
          </span>
          <ChoiceCheck checked={ai === option.id} />
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={ai === NO_AI}
        className={styles.choice}
        onClick={() => onAi(NO_AI)}
      >
        <span className={styles.choiceMark}>
          <CircleSlash size={18} aria-hidden="true" />
        </span>
        <span className={styles.choiceText}>
          <span className={styles.choiceLabel}>{t('setup.ai.none')}</span>
          <span className={styles.choiceHint}>{t('setup.ai.noneHint')}</span>
        </span>
        <ChoiceCheck checked={ai === NO_AI} />
      </button>
    </div>
  )
}

// The household's AI, or none; with a provider, its key and the country its web searches use.
const AiStep = (props: AiStepProps) => {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const { provider } = props
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        props.onNext()
      }}
    >
      <StepHeader
        step={props.step}
        total={props.total}
        title={t('setup.ai.title')}
        intro={t('setup.ai.intro')}
        help={{ id: 'setup-ai', title: t('setup.ai.helpTitle'), body: <p>{t('setup.ai.help')}</p> }}
      />
      <AiChoices providers={props.providers} ai={props.ai} onAi={props.onAi} />
      {provider && (
        <AiKeyField
          provider={provider}
          value={props.aiKey}
          onChange={props.onAiKey}
          result={props.keyCheck}
          onResult={props.onKeyCheck}
          check={props.checkKey}
        />
      )}
      {/* Only the AI's web searches use it: asked with the AI only. */}
      {provider && (
        <div className={settingsStyles.card}>
          <SettingRow
            label={t('regions.country')}
            value={props.country ? countryName(props.country) : t('common.none')}
            action={{ label: t('common.change'), icon: MapPin, onClick: () => setPicking(true) }}
          />
        </div>
      )}
      <CountryPicker open={picking} value={props.country} onPick={props.onCountry} onClose={() => setPicking(false)} />
      <Actions onBack={props.onBack}>
        <Button type="submit" look="primary" disabled={provider !== null && props.keyCheck !== 'ok'}>
          {t('common.continue')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </Actions>
    </form>
  )
}

export default AiStep
