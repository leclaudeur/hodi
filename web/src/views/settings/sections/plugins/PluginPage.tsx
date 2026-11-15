import { Puzzle } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import PluginSlot from '../../../../plugins/PluginSlot.tsx'
import { usePlugins } from '../../../../plugins/registry.ts'
import EmptyState from '../../../../ui/EmptyState.tsx'
import SectionPage from '../../SectionPage.tsx'
import RowsSkeleton from '../../SettingsSkeleton.tsx'
import { pluginName } from '../../../../plugins/plugin-texts.ts'

// A plugin's own page in Réglages, the entry its manifest places there: the plugin draws all of it, title included,
// with the SDK's SectionPage. Turned off, removed or broken, the address says so instead.
const PluginPage = ({ id, layout }: { id: string; layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const { ready, plugins, web } = usePlugins()
  const plugin = plugins.find(entry => entry.id === id)
  const Page = web.get(id)?.page
  // The same component while the page and the layout stay, so the plugin's page keeps what it holds when Réglages
  // draws again (the plugins' list refreshing, say).
  const slot = useMemo(() => (Page ? () => <Page layout={layout} /> : null), [Page, layout])

  if (!ready)
    return (
      <SectionPage title={t('settings.titles.plugins')} layout={layout}>
        <RowsSkeleton rows={3} />
      </SectionPage>
    )

  if (!plugin || !plugin.enabled || plugin.error || !slot)
    return (
      <SectionPage title={plugin?.name ?? t('settings.titles.plugins')} layout={layout}>
        <EmptyState icon={<Puzzle size={20} />} title={t('plugins.pageMissingTitle')}>
          {t('plugins.pageMissingText')}
        </EmptyState>
      </SectionPage>
    )

  return (
    <PluginSlot
      id={id}
      component={slot}
      fallback={
        <SectionPage title={pluginName(plugin)} layout={layout}>
          <EmptyState icon={<Puzzle size={20} />} title={t('plugins.pageFailedTitle')} tone="danger">
            {t('plugins.pageFailedText')}
          </EmptyState>
        </SectionPage>
      }
    />
  )
}

export default PluginPage
