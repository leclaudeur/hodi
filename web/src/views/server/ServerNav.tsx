import {
  ArchiveRestore,
  ChartColumn,
  ChevronRight,
  Clock,
  Heart,
  Mail,
  House,
  LogOut,
  Puzzle,
  UserRound,
  UsersRound
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORT_URL, logout } from '../../api.ts'
import sidebarStyles from '../../app/Sidebar.module.css'
import { isServerOnly } from '../../lib/server-only.ts'
import { type ServerSection, SERVER_HREF, serverHref, serverPluginPageHref } from '../../lib/use-hash-route.ts'
import { serverPluginGroups } from '../../plugins/menu.ts'
import PluginSlot from '../../plugins/PluginSlot.tsx'
import { pluginNamespace, usePlugins } from '../../plugins/registry.ts'
import Logo from '../../ui/Logo.tsx'
import PhoneHeader from '../../ui/PhoneHeader.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import ScrollArea from '../../ui/ScrollArea.tsx'
import navStyles from '../settings/SettingsNav.module.css'
import styles from './Server.module.css'
import { pluginName, pluginDescription } from '../../plugins/plugin-texts.ts'

interface Entry {
  // What the sidebar marks as open: a section's id, or plugin/<id>/<section> (serverPluginKey).
  id: string
  href: string
  label: string
  hint: ReactNode
  icon: ComponentType<{ size?: number }>
  // A page out of Hodi, opened in a new tab.
  external?: true
}

// A plugin's section, as the sidebar knows it.
export const serverPluginKey = (plugin: string, section: string) => `plugin/${plugin}/${section}`

// The server's sections, in groups, as Réglages lists its own; each plugin's own group under them, named after it.
const useGroups = (): { id: string; label: string; entries: Entry[] }[] => {
  const { t, i18n } = useTranslation()
  const { plugins, web } = usePlugins()
  const core: { id: string; label: string; entries: (Omit<Entry, 'href' | 'id'> & { id: ServerSection })[] }[] = [
    // The server at a glance, first and with no heading, as Réglages opens on the profile.
    {
      id: 'server',
      label: '',
      entries: [
        { id: 'overview', label: t('server.titles.overview'), hint: t('server.hints.overview'), icon: ChartColumn },
        {
          id: 'households',
          label: t('server.titles.households'),
          hint: t('server.hints.households'),
          icon: UsersRound
        },
        { id: 'accounts', label: t('server.titles.accounts'), hint: t('server.hints.accounts'), icon: UserRound }
      ]
    },
    {
      id: 'settings',
      label: t('server.groups.settings'),
      entries: [
        { id: 'content', label: t('server.titles.content'), hint: t('server.hints.content'), icon: Clock },
        { id: 'backups', label: t('server.titles.backups'), hint: t('server.hints.backups'), icon: ArchiveRestore },
        { id: 'mail', label: t('server.titles.mail'), hint: t('server.hints.mail'), icon: Mail },
        {
          id: 'plugins',
          label: t('server.titles.plugins'),
          hint: plugins.length ? t('plugins.count', { count: plugins.length }) : t('settings.hints.plugins'),
          icon: Puzzle
        }
      ]
    }
  ]
  const own = serverPluginGroups(plugins, web).map(({ plugin, sections }) => ({
    id: `plugin:${plugin.id}`,
    label: pluginName(plugin),
    entries: sections.map(({ id, label, hint: Hint, icon }) => ({
      id: serverPluginKey(plugin.id, id),
      href: serverPluginPageHref(plugin.id, id),
      label: String(i18n.t(label as never, { ns: pluginNamespace(plugin.id) } as never)),
      // Drawn by the plugin, in its slot: an error there leaves its description.
      hint: Hint ? (
        <PluginSlot id={plugin.id} component={Hint} fallback={pluginDescription(plugin)} />
      ) : (
        pluginDescription(plugin)
      ),
      icon: icon ?? Puzzle
    }))
  }))
  return [
    ...core.map(group => ({
      ...group,
      entries: group.entries.map(entry => ({ ...entry, href: serverHref(entry.id) }))
    })),
    ...own,
    // Last, out of Hodi: whoever runs a server for others is the likeliest to give to its work.
    {
      id: 'support',
      label: '',
      entries: [
        {
          id: 'support',
          href: SUPPORT_URL,
          label: t('server.support'),
          hint: t('server.supportHint'),
          icon: Heart,
          external: true
        }
      ]
    }
  ]
}

// A new tab for a page out of Hodi.
const target = (external?: true) => (external ? { target: '_blank', rel: 'noreferrer' } : {})

// Back to the app, or, with no household yet, the way out: there is no app to go back to.
const BackToApp = () => {
  const { t } = useTranslation()
  if (isServerOnly())
    return (
      <RoundButton
        icon={LogOut}
        label={t('server.logout')}
        size={44}
        onClick={() => {
          void logout()
            .catch(() => {})
            .finally(() => {
              window.location.replace('#/')
              window.location.reload()
            })
        }}
      />
    )
  return <RoundButton icon={House} label={t('server.backToApp')} size={44} href="#/" />
}

// The server's own sidebar, built as the app's: the logo, then the house back to the app where the app has its search,
// then the sections. No profile and no foot: the server's admin may read in no household of it.
export const ServerSidebar = ({ active }: { active: string }) => {
  const { t } = useTranslation()
  const groups = useGroups()
  return (
    <nav className={sidebarStyles.sidebar} aria-label={t('server.nav')}>
      <div className={sidebarStyles.header}>
        <a href={SERVER_HREF} className={sidebarStyles.logo} aria-label={t('server.title')}>
          <Logo />
        </a>
        <div className={sidebarStyles.actions}>
          <BackToApp />
        </div>
      </div>
      <div className={sidebarStyles.rule} />
      <ScrollArea className={sidebarStyles.scroll}>
        {groups.map((group, index) => (
          <div key={group.id}>
            {index > 0 && <div className={sidebarStyles.divider} />}
            {group.label && <span className={sidebarStyles.heading}>{group.label}</span>}
            <ul className={sidebarStyles.links}>
              {group.entries.map(({ id, href, label, icon: Icon, external }) => (
                <li key={id}>
                  <a
                    className={sidebarStyles.link}
                    href={href}
                    aria-current={id === active ? 'page' : undefined}
                    {...target(external)}
                  >
                    <span className={sidebarStyles.square}>
                      <Icon size={14} aria-hidden="true" />
                    </span>
                    <span className={sidebarStyles.label}>{label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </ScrollArea>
    </nav>
  )
}

// On a phone or a tablet held upright: the space's first level, its sections as Réglages lists them, with no tab bar.
export const ServerHome = () => {
  const { t } = useTranslation()
  const groups = useGroups()
  return (
    <section className={`${navStyles.nav} ${navStyles.phone} ${styles.home}`} aria-label={t('server.title')}>
      <PhoneHeader title={t('server.title')} back={<BackToApp />} />
      <div className={navStyles.groups}>
        {groups.map(group => (
          <section key={group.id} className={navStyles.group} aria-label={group.label || undefined}>
            {group.label && <h2 className={navStyles.groupLabel}>{group.label}</h2>}
            <ul className={navStyles.entries}>
              {group.entries.map(({ id, href, label, hint, icon: Icon, external }) => (
                <li key={id}>
                  <a className={navStyles.entry} href={href} {...target(external)}>
                    <span className={navStyles.icon} aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span className={navStyles.text}>
                      <span className={navStyles.label}>{label}</span>
                      <span className={navStyles.hint}>{hint}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" className={navStyles.chevron} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
