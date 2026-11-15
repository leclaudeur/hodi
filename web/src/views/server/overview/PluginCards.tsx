import { useTranslation } from 'react-i18next'
import type { ServerDay } from '../../../api.ts'
import OverviewCard from '../../../plugins/OverviewCard.tsx'
import PluginSlot from '../../../plugins/PluginSlot.tsx'
import { overviewPluginCards } from '../../../plugins/menu.ts'
import { pluginName } from '../../../plugins/plugin-texts.ts'
import { type PluginInfo, usePlugins } from '../../../plugins/registry.ts'
import cards from './OverviewCards.module.css'
import styles from './Overview.module.css'

// In place of a card whose code failed: the plugin's name, and the card's place kept.
const Failed = ({ plugin }: { plugin: PluginInfo }) => {
  const { t } = useTranslation()
  return (
    <OverviewCard title={pluginName(plugin)}>
      <p className={cards.nobody}>{t('server.overview.pluginFailed')}</p>
    </OverviewCard>
  )
}

// The plugins' cards, with the period shown: from its first day to its last.
const PluginCards = ({ days }: { days: ServerDay[] }) => {
  const { plugins, web } = usePlugins()
  const from = days[0]?.day
  const to = days.at(-1)?.day
  const slots = overviewPluginCards(plugins, web)
  if (!from || !to || !slots.length) return null
  // A grid of their own: however their sizes add up, Hodi's cards after them keep their rows.
  return (
    <div className={styles.plugins}>
      {slots.map(({ plugin, card }) => (
        <div key={`${plugin.id}:${card.id}`} className={`${styles.slot} ${styles[card.size]}`}>
          <PluginSlot
            id={plugin.id}
            component={card.component}
            props={{ from, to }}
            fallback={<Failed plugin={plugin} />}
          />
        </div>
      ))}
    </div>
  )
}

export default PluginCards
