import { useTranslation } from 'react-i18next'
import Checkbox from '../ui/Checkbox.tsx'
import { AgeConsentText } from './Slots.tsx'

// « J'ai au moins 13 ans », followed by every plugin's consent line (its conditions, its privacy page): the one box a
// form that makes an account ticks, Hodi's own or a plugin's.
const AgeCheckbox = ({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) => {
  const { t } = useTranslation()
  return (
    <Checkbox checked={checked} onChange={onChange}>
      {t('join.age')}
      <AgeConsentText />
    </Checkbox>
  )
}

export default AgeCheckbox
