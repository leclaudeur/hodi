import { Download, Puzzle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CatalogPlugin } from '../../../../plugins/catalog.ts'
import { pluginDescription, pluginName } from '../../../../plugins/plugin-texts.ts'
import Chip from '../../../../ui/Chip.tsx'
import StatusLine from '../../../../ui/StatusLine.tsx'
import RowsSkeleton from '../../SettingsSkeleton.tsx'
import { RowButton } from '../../SettingRow.tsx'
import styles from '../../Settings.module.css'
import own from './Plugins.module.css'

interface AvailablePluginsProps {
  // null while the registry is read; failed when it could not be.
  plugins: CatalogPlugin[] | null
  failed: boolean
  phone: boolean
  // The plugin being downloaded and checked, its button busy.
  staging: string | null
  onInstall: (plugin: CatalogPlugin) => void
}

const AvailableRow = ({
  plugin,
  phone,
  busy,
  disabled,
  onInstall
}: {
  plugin: CatalogPlugin
  phone: boolean
  busy: boolean
  disabled: boolean
  onInstall: () => void
}) => {
  const { t } = useTranslation()
  return (
    <li className={styles.row}>
      <span className={own.mark} aria-hidden="true">
        <Puzzle size={20} />
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{pluginName(plugin)}</span>
        <span className={styles.rowHint}>{pluginDescription(plugin)}</span>
      </span>
      {!phone && (
        <Chip tone="success" size="row">
          {plugin.version}
        </Chip>
      )}
      <RowButton
        label={t('plugins.catalog.install')}
        ariaLabel={t('plugins.catalog.installLabel', { name: pluginName(plugin) })}
        icon={Download}
        busy={busy}
        disabled={disabled}
        onClick={onInstall}
      />
    </li>
  )
}

// Serveur › Plugins › Disponibles: the plugins of Hodi's registry this server does not have, each installed with the
// same questions as a file. Nothing when the registry has nothing more to offer.
const AvailablePlugins = ({ plugins, failed, phone, staging, onInstall }: AvailablePluginsProps) => {
  const { t } = useTranslation()
  if (plugins?.length === 0) return null
  return (
    <>
      <h2 className={styles.label}>{t('plugins.catalog.title')}</h2>
      {failed && <StatusLine tone="error">{t('plugins.catalog.failed')}</StatusLine>}
      {!failed && !plugins && <RowsSkeleton rows={2} lead="square" end="button" />}
      {plugins && (
        <ul className={styles.card}>
          {plugins.map(plugin => (
            <AvailableRow
              key={plugin.id}
              plugin={plugin}
              phone={phone}
              busy={staging === plugin.id}
              disabled={staging !== null && staging !== plugin.id}
              onInstall={() => onInstall(plugin)}
            />
          ))}
        </ul>
      )}
    </>
  )
}

export default AvailablePlugins
