import { FileUp, Puzzle } from 'lucide-react'
import type { TFunction } from 'i18next'
import { Fragment, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsPhone } from '../../../../lib/use-media.ts'
import PluginSlot from '../../../../plugins/PluginSlot.tsx'
import { type PluginInfo, usePlugins } from '../../../../plugins/registry.ts'
import Button from '../../../../ui/Button.tsx'
import StatusLine from '../../../../ui/StatusLine.tsx'
import EmptyCard from '../../EmptyCard.tsx'
import SectionPage from '../../SectionPage.tsx'
import RowsSkeleton from '../../SettingsSkeleton.tsx'
import styles from '../../Settings.module.css'
import AddPluginDialog from './AddPluginDialog.tsx'
import DevMode from './DevMode.tsx'
import own from './Plugins.module.css'
import { PluginOptions } from './PluginOptions.tsx'
import { PluginFacts, PluginNotice, PluginRow, RemoveRows, UpdateNotice } from './PluginParts.tsx'
import AvailablePlugins from './AvailablePlugins.tsx'
import { useCatalog } from './use-catalog.ts'
import RestartScreen from './RestartScreen.tsx'
import { usePluginsAdmin } from './use-plugins-admin.tsx'
import { pluginName, pluginDescription } from '../../../../plugins/plugin-texts.ts'

type Layout = 'desktop' | 'phone'
type Admin = ReturnType<typeof usePluginsAdmin>
type Catalog = ReturnType<typeof useCatalog>

interface PageInput {
  opened: PluginInfo
  admin: Admin
  layout: Layout
  // The settings page the plugin draws itself, if it has one.
  Page: Parameters<typeof PluginSlot>[0]['component'] | undefined
  onUpdate: () => void
  catalog: Catalog
  // The add dialogs and the restart screen, at the page's end.
  extras: ReactNode[]
}

// One plugin's page: its version, on or off, its settings, then what it draws itself. A plain function, not a
// component: the list and a plugin's page keep the same SectionPage, as before.
const pluginPage = ({ opened, admin, layout, Page, onUpdate, catalog, extras }: PageInput) => (
  <SectionPage title={pluginName(opened)} intro={pluginDescription(opened) ?? undefined} layout={layout}>
    <UpdateNotice
      plugin={opened}
      version={catalog.updateOf(opened)}
      busy={catalog.staging === opened.id}
      error={catalog.error}
      onUpdate={() => void catalog.stage(opened.id)}
    />
    <PluginNotice plugin={opened} onUpdate={onUpdate} />
    <PluginFacts plugin={opened} onEnabled={enabled => admin.change(opened, { enabled })} />
    <PluginOptions plugin={opened} layout={layout} onSave={settings => admin.change(opened, { settings })} />
    {opened.enabled && Page && <PluginSlot id={opened.id} component={Page} />}
    <RemoveRows onRemove={withData => admin.remove(opened, withData)} />
    {extras}
  </SectionPage>
)

interface ListInput {
  plugins: PluginInfo[]
  admin: Admin
  layout: Layout
  phone: boolean
  t: TFunction
  onAdd: () => void
  catalog: Catalog
  extras: ReactNode[]
}

const pluginList = ({ plugins, admin, layout, phone, t, onAdd, catalog, extras }: ListInput) => (
  <SectionPage title={t('settings.titles.plugins')} intro={t('server.pluginsIntro')} layout={layout}>
    {plugins.length === 0 ? (
      <EmptyCard icon={<Puzzle size={18} />} title={t('plugins.emptyTitle')} hint={t('plugins.emptyText')} />
    ) : (
      <ul className={styles.card}>
        {plugins.map(plugin => (
          <PluginRow key={plugin.id} plugin={plugin} phone={phone} update={catalog.updateOf(plugin)} />
        ))}
      </ul>
    )}
    <AvailablePlugins
      plugins={catalog.available}
      failed={catalog.failed}
      phone={phone}
      staging={catalog.staging}
      onInstall={plugin => void catalog.stage(plugin.id)}
    />
    {catalog.error && !catalog.staged && <StatusLine tone="error">{catalog.error}</StatusLine>}
    <div className={own.actions}>
      <Button icon={FileUp} onClick={onAdd}>
        {t('plugins.add.fromFile')}
      </Button>
    </div>
    <DevMode onRestart={change => admin.setRestarting({ change, step: t('plugins.devMode.restarting'), failed: '' })} />
    {extras}
  </SectionPage>
)

// What was added to Hodi, in the server's space (Serveur › Plugins): its admin adds them, turns them on and off, sets
// and removes them. Only the server's admin reaches it: the server refuses anyone else these changes anyway.
const PluginsSection = ({ item, layout }: { item?: string; layout: Layout }) => {
  const { t } = useTranslation()
  const { web } = usePlugins()
  const phone = useIsPhone()
  const admin = usePluginsAdmin()
  const [adding, setAdding] = useState(false)
  const { plugins, restarting } = admin
  const catalog = useCatalog(plugins ?? null)

  const restartScreen = restarting && (
    <RestartScreen change={restarting.change} step={restarting.step} onFailed={admin.restartFailed} />
  )
  // The dialog stays open under the restart screen until the page reloads: closing it first showed the page.
  const installed = (name: string, before: string | null) =>
    admin.setRestarting({
      change: Promise.resolve(before),
      step: t('plugins.restart.installing', { name }),
      failed: ''
    })
  const extras = [
    <AddPluginDialog key="file" open={adding} onClose={() => setAdding(false)} onInstalled={installed} />,
    catalog.staged && (
      <AddPluginDialog
        key={catalog.staged.token}
        open
        initial={catalog.staged}
        onClose={catalog.clear}
        onInstalled={installed}
      />
    ),
    <Fragment key="restart">{restartScreen}</Fragment>
  ]
  const opened = item ? plugins?.find(plugin => plugin.id === item) : undefined

  if (!plugins)
    return (
      <SectionPage title={t('settings.titles.plugins')} intro={t('server.pluginsIntro')} layout={layout}>
        {admin.failed ? (
          <StatusLine tone="error">{t('plugins.loadFailed')}</StatusLine>
        ) : (
          <RowsSkeleton rows={2} lead="square" end="button" />
        )}
      </SectionPage>
    )

  if (opened) {
    const Page = web.get(opened.id)?.settingsPage
    return pluginPage({ opened, admin, layout, Page, onUpdate: () => setAdding(true), catalog, extras })
  }
  return pluginList({ plugins, admin, layout, phone, t, onAdd: () => setAdding(true), catalog, extras })
}

export default PluginsSection
