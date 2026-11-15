import { AlertCircle, ArrowUpCircle, Download, Puzzle, ShieldAlert, SlidersHorizontal, Trash2 } from 'lucide-react'
import StatusLine from '../../../../ui/StatusLine.tsx'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { serverPluginHref } from '../../../../lib/use-hash-route.ts'
import type { PluginInfo } from '../../../../plugins/registry.ts'
import Chip from '../../../../ui/Chip.tsx'
import Notice from '../../../../ui/Notice.tsx'
import RichText from '../../../../ui/RichText.tsx'
import Toggle from '../../../../ui/Toggle.tsx'
import SettingRow, { RowButton } from '../../SettingRow.tsx'
import styles from '../../Settings.module.css'
import own from './Plugins.module.css'
import { OUTDATED_API } from './PluginOptions.tsx'
import { pluginName, pluginDescription } from '../../../../plugins/plugin-texts.ts'

// Off, broken, outdated or unsigned, said at the row's end; nothing when it works.
export const stateOf = (plugin: PluginInfo, t: TFunction) => {
  if (plugin.error === OUTDATED_API) return t('plugins.outdatedChip')
  if (plugin.error) return t('plugins.brokenChip')
  if (!plugin.enabled) return t('settings.hints.off')
  if (plugin.dev) return t('plugins.devChip')
  return plugin.signed ? null : t('plugins.unsignedChip')
}

// What is wrong with it, first: off because too old (with the way out), broken, or not checked by anyone.
export const PluginNotice = ({ plugin, onUpdate }: { plugin: PluginInfo; onUpdate: () => void }) => {
  const { t } = useTranslation()
  if (plugin.error === OUTDATED_API)
    return (
      <Notice
        tone="error"
        icon={AlertCircle}
        title={t('plugins.outdatedTitle', { name: pluginName(plugin) })}
        action={{ label: t('plugins.installUpdate'), icon: Download, onClick: onUpdate }}
      >
        {t('plugins.outdated')}
      </Notice>
    )
  if (plugin.error)
    return (
      <Notice tone="error" icon={AlertCircle} title={t('plugins.brokenTitle', { name: pluginName(plugin) })}>
        {t('plugins.broken', { error: plugin.error })}
      </Notice>
    )
  if (plugin.signed) return null
  return plugin.dev ? (
    <Notice tone="warning" icon={ShieldAlert} title={t('plugins.devTitle')}>
      <RichText i18nKey="plugins.dev" />
    </Notice>
  ) : (
    <Notice tone="warning" icon={ShieldAlert} title={t('plugins.unsignedTitle')}>
      {t('plugins.unsigned')}
    </Notice>
  )
}

// A newer version in Hodi's registry, installed with the same questions as a file.
export const UpdateNotice = ({
  plugin,
  version,
  busy,
  error,
  onUpdate
}: {
  plugin: PluginInfo
  version: string | null
  busy: boolean
  error: string | null
  onUpdate: () => void
}) => {
  const { t } = useTranslation()
  if (!version) return null
  return (
    <>
      <Notice
        icon={ArrowUpCircle}
        title={t('plugins.catalog.updateTitle', { name: pluginName(plugin), version })}
        action={{
          label: t(busy ? 'plugins.catalog.downloading' : 'plugins.installUpdate'),
          icon: Download,
          onClick: onUpdate
        }}
      >
        {t('plugins.catalog.update', { version: plugin.version })}
      </Notice>
      {error && <StatusLine tone="error">{error}</StatusLine>}
    </>
  )
}

const enabledHint = (plugin: PluginInfo) => {
  if (plugin.error === OUTDATED_API) return 'plugins.outdatedToggleHint'
  return plugin.enabled ? 'plugins.enabledHint' : 'plugins.disabledHint'
}

// Its version, and on or off.
export const PluginFacts = ({ plugin, onEnabled }: { plugin: PluginInfo; onEnabled: (enabled: boolean) => void }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.card}>
      <SettingRow label={t('plugins.version')} hint={t('plugins.versionHint')}>
        <Chip tone="success" size="row">
          {plugin.version ?? '?'}
        </Chip>
      </SettingRow>
      <SettingRow label={t('plugins.enabled')} hint={t(enabledHint(plugin))}>
        <Toggle
          checked={plugin.enabled}
          label={t('plugins.enabled')}
          disabled={Boolean(plugin.error)}
          onChange={onEnabled}
        />
      </SettingRow>
    </div>
  )
}

// Removing it, as a young profile is deleted: its own card at the bottom, a red button and a question.
export const RemoveRows = ({ onRemove }: { onRemove: (withData: boolean) => void }) => {
  const { t } = useTranslation()
  return (
    <>
      <h2 className={styles.label}>{t('plugins.plugin')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('plugins.remove')}
          hint={t('plugins.removeHint')}
          action={{ label: t('plugins.removeButton'), look: 'danger', icon: Trash2, onClick: () => onRemove(false) }}
        />
        <SettingRow
          label={t('plugins.removeAll')}
          hint={t('plugins.removeAllHint')}
          action={{ label: t('plugins.removeAllButton'), look: 'danger', icon: Trash2, onClick: () => onRemove(true) }}
        />
      </div>
    </>
  )
}

const hintOf = (plugin: PluginInfo, phone: boolean, t: TFunction) => {
  if (phone && plugin.error !== OUTDATED_API && stateOf(plugin, t)) return stateOf(plugin, t)
  if (plugin.error === OUTDATED_API) return t('plugins.outdatedHint')
  return plugin.error ? t('plugins.brokenHint') : pluginDescription(plugin)
}

const chipTone = (plugin: PluginInfo) => {
  if (plugin.error) return 'danger'
  return !plugin.signed && plugin.enabled ? 'warning' : undefined
}

// A plugin in the list: its mark, its name over its state or description, its chips and « Gérer ».
export const PluginRow = ({ plugin, phone, update }: { plugin: PluginInfo; phone: boolean; update: string | null }) => {
  const { t } = useTranslation()
  const state = stateOf(plugin, t)
  // On a phone the state has no room at the row's end: it takes the hint's place, as a source's. An outdated plugin
  // says why in red at every size, since it is off without anyone turning it off.
  const red = (phone && state && plugin.error) || plugin.error === OUTDATED_API
  return (
    <li className={styles.row}>
      <span className={own.mark} aria-hidden="true">
        {plugin.error ? <AlertCircle size={20} /> : <Puzzle size={20} />}
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{pluginName(plugin)}</span>
        <span className={`${styles.rowHint} ${red ? own.stateHint : ''}`}>{hintOf(plugin, phone, t)}</span>
      </span>
      {!phone && state && (
        <Chip tone={chipTone(plugin)} size="row">
          {state}
        </Chip>
      )}
      {/* On a phone the description gets the room, and a plugin in development changes at each build: the version is
      on the plugin's own page. */}
      {!phone && !plugin.error && !plugin.dev && plugin.version && (
        // A newer version in Hodi's registry is said in its place.
        <Chip tone={update ? 'accent' : 'success'} size="row">
          {update ? t('plugins.catalog.updateChip', { version: update }) : plugin.version}
        </Chip>
      )}
      <RowButton
        label={t('plugins.manage')}
        ariaLabel={t('plugins.manageLabel', { name: pluginName(plugin) })}
        icon={SlidersHorizontal}
        href={serverPluginHref(plugin.id)}
      />
    </li>
  )
}
