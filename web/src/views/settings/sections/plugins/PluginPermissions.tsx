import {
  Bell,
  Database,
  DoorOpen,
  Globe,
  House,
  KeyRound,
  type LucideIcon,
  Mail,
  Newspaper,
  Rss,
  Sparkles,
  UserPlus
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PluginPermissions as Permissions } from '../../../../api.ts'
import SettingRow from '../../SettingRow.tsx'
import styles from '../../Settings.module.css'
import own from './Plugins.module.css'

// What a plugin may ask of Hodi, in the order an admin weighs it: the plugin's own data first, then what reaches
// beyond it. Hodi refuses anything the manifest did not declare.
const GRANTS: { key: Exclude<keyof Permissions, 'network'>; icon: LucideIcon }[] = [
  { key: 'articles', icon: Newspaper },
  { key: 'households', icon: House },
  { key: 'accounts', icon: UserPlus },
  { key: 'signIn', icon: KeyRound },
  { key: 'publicRoutes', icon: DoorOpen },
  { key: 'mail', icon: Mail },
  { key: 'notify', icon: Bell },
  { key: 'ai', icon: Sparkles }
]

// « Ce que ce plugin pourra faire »: shown before installing, as a site lists what a connected service will do.
const PluginPermissions = ({
  permissions,
  feeds = []
}: {
  permissions: Permissions
  feeds?: { name: string; site: string }[]
}) => {
  const { t } = useTranslation()
  const row = (key: string, Icon: LucideIcon, values?: Record<string, unknown>) => (
    <SettingRow
      key={key}
      lead={
        <span className={own.mark}>
          <Icon size={20} aria-hidden="true" />
        </span>
      }
      label={String(t(`plugins.permissions.${key}` as never, values as never))}
      hint={String(t(`plugins.permissions.${key}Hint` as never, values as never))}
    />
  )
  const hosts = permissions.network
  return (
    <>
      <h2 className={styles.label}>{t('plugins.permissions.title')}</h2>
      <div className={styles.card}>
        {row('data', Database)}
        {hosts.length > 0 && row('network', Globe, { count: hosts.length, hosts: hosts.join(', ') })}
        {GRANTS.filter(grant => permissions[grant.key]).map(grant => row(grant.key, grant.icon))}
        {feeds.length > 0 && row('feeds', Rss, { count: feeds.length, names: feeds.map(feed => feed.name).join(', ') })}
      </div>
    </>
  )
}

export default PluginPermissions
