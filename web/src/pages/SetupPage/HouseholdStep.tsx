import { ArrowRight, Home } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MAX_HOUSEHOLD_NAME_LENGTH } from '../../api.ts'
import Button from '../../ui/Button.tsx'
import TextField from '../../ui/TextField.tsx'
import householdStyles from '../../views/household/Household.module.css'
import { Actions, StepHeader } from '../SetupParts.tsx'
import styles from '../SetupPage.module.css'

interface HouseholdStepProps {
  step: number
  total: number
  name: string
  onName: (value: string) => void
  onNext: () => void
  onBack: () => void
}

// The household's name.
const HouseholdStep = ({ step, total, name, onName, onNext, onBack }: HouseholdStepProps) => {
  const { t } = useTranslation()
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        if (name.trim() !== '') onNext()
      }}
    >
      <StepHeader
        step={step}
        total={total}
        title={t('setup.household.title')}
        intro={t('setup.household.intro')}
        help={{
          id: 'setup-household',
          title: t('setup.household.helpTitle'),
          body: <p>{t('setup.household.help')}</p>
        }}
      />
      <label className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('setup.household.name')}</span>
        <TextField
          icon={Home}
          aria-label={t('setup.household.name')}
          placeholder={t('setup.household.namePlaceholder')}
          maxLength={MAX_HOUSEHOLD_NAME_LENGTH}
          autoFocus
          required
          value={name}
          onChange={event => onName(event.target.value)}
        />
      </label>
      <Actions onBack={onBack}>
        <Button type="submit" look="primary" disabled={name.trim() === ''}>
          {t('common.continue')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </Actions>
    </form>
  )
}

export default HouseholdStep
