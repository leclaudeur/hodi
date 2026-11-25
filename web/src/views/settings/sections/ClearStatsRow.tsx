import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { askToConfirm, ownProof } from '../../../lib/confirm.ts'
import { clearReadings } from '../../../lib/reading-stats.ts'
import { showDone } from '../../../lib/toast.ts'
import RichText from '../../../ui/RichText.tsx'
import SettingRow from '../SettingRow.tsx'

// The profile's stats, badges and levels, cleared on every device after a confirm.
const ClearStatsRow = () => {
  const { t } = useTranslation()
  return (
    <SettingRow
      label={t('settings.me.clearStats')}
      hint={t('settings.me.clearStatsHint')}
      action={{
        label: t('settings.me.clearAction'),
        look: 'danger',
        icon: Trash2,
        onClick: () =>
          askToConfirm({
            title: t('confirm.clearStats.title'),
            message: <RichText i18nKey="confirm.clearStats.message" />,
            label: t('confirm.clearStats.button'),
            proof: ownProof(),
            onConfirm: async proof => {
              await clearReadings(proof)
              showDone(t('settings.me.clearStatsDone'))
            }
          })
      }}
    />
  )
}

export default ClearStatsRow
