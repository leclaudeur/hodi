import {
  Activity,
  Bell,
  ChartColumn,
  CircleUser,
  Database,
  EyeOff,
  History,
  House,
  Info,
  Keyboard,
  Layers,
  type LucideIcon,
  Puzzle,
  Rss,
  Send,
  Server,
  Type,
  Users
} from 'lucide-react'
import type { TFunction } from 'i18next'
import type { ComponentType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Profile } from '../../api.ts'
import { useMyRequests } from '../../lib/my-requests.ts'
import { useNotificationSettings } from '../../lib/notifications.ts'
import { usePreferences } from '../../lib/preferences.ts'
import { isYoung, useProfiles } from '../../lib/profiles.ts'
import { callsLeft, sourceState, useAiUsage, useSourceStatuses } from '../../lib/settings-data.ts'
import { HISTORY_HREF, SERVER_HREF, type SettingsSection, pluginPageHref } from '../../lib/use-hash-route.ts'
import PluginSlot from '../../plugins/PluginSlot.tsx'
import { menuPlugins, placePlugins } from '../../plugins/menu.ts'
import { type PluginInfo, type WebPlugin, usePlugins } from '../../plugins/registry.ts'
import { pluginName, pluginDescription } from '../../plugins/plugin-texts.ts'

export interface Entry {
  // Historique is a page of the app, not a settings section: it has its own address. A plugin's page is
  // plugin:<its id>.
  id: SettingsSection | 'history' | 'server' | `plugin:${string}`
  href?: string
  label: string
  hint: ReactNode
  icon: LucideIcon | 'ai' | ComponentType<{ size?: number }>
  // Keyboard shortcuts mean nothing on a phone.
  desktopOnly?: boolean
  // Sharing means nothing in a household of one; the household's own settings are the admin's.
  hidden?: boolean
}

export interface Group {
  id: string
  label: string
  hidden?: boolean
  entries: Entry[]
}

// What the groups' entries say right now.
interface GroupData {
  t: TFunction
  preferences: ReturnType<typeof usePreferences>
  notifications: ReturnType<typeof useNotificationSettings>
  sources: ReturnType<typeof useSourceStatuses>['value']
  usage: ReturnType<typeof useAiUsage>['value']
  household: ReturnType<typeof useProfiles>
  profile: Profile | undefined
  failing: number
  asked: number
  young: boolean
}

// What is read, and about what.
const readingGroups = ({ t, sources, failing, asked, preferences }: GroupData): Group[] => [
  {
    id: 'reading',
    label: t('settings.groups.reading'),
    entries: [
      { id: 'reading', label: t('settings.nav.reading'), hint: t('settings.hints.reading'), icon: Type },
      { id: 'themes', label: t('settings.nav.themes'), hint: t('settings.hints.themes'), icon: Layers },
      {
        id: 'sources',
        label: t('settings.nav.sources'),
        hint: sources
          ? `${t('count.source', { count: sources.length })}${failing ? `, ${t('settings.hints.failing', { count: failing })}` : ''}${asked ? ` · ${t('requests.count', { count: asked })}` : ''}`
          : t('settings.hints.sources'),
        icon: Rss
      },
      {
        id: 'history',
        href: HISTORY_HREF,
        label: t('settings.reading.history'),
        hint: t('settings.hints.history'),
        icon: History
      }
    ]
  },
  {
    id: 'subjects',
    label: t('settings.groups.subjects'),
    entries: [
      {
        id: 'followed',
        label: t('settings.nav.followed'),
        hint: preferences.followedWords.length
          ? t('count.subject', { count: preferences.followedWords.length })
          : t('settings.hints.none'),
        icon: Activity
      },
      {
        id: 'muted',
        label: t('settings.nav.muted'),
        hint: preferences.mutedWords.length
          ? t('count.word', { count: preferences.mutedWords.length })
          : t('settings.hints.none'),
        icon: EyeOff
      }
    ]
  }
]

// The profile's own: itself, its stats, its account and its sharing.
const yourGroups = ({ t, preferences, young, household }: GroupData): Group[] => [
  {
    id: 'you',
    label: t('settings.groups.you'),
    entries: [
      {
        id: 'me',
        label: t('settings.nav.me'),
        hint: young ? t('limits.meHint') : t('settings.hints.me'),
        icon: CircleUser
      },
      { id: 'stats', label: t('settings.nav.stats'), hint: t('settings.hints.stats'), icon: ChartColumn },
      // The account and what Hodi keeps: this device's part (its session, offline reading) with the rest.
      { id: 'account', label: t('settings.nav.account'), hint: t('settings.hints.account'), icon: Database },
      {
        id: 'sharing',
        label: t('settings.nav.sharing'),
        hint: t(preferences.sharing ? 'settings.hints.on' : 'settings.hints.off'),
        icon: Send,
        hidden: (household?.profiles.length ?? 0) < 2
      }
    ]
  }
]

// The household's, for its adults.
const householdGroups = ({ t, young, profile, household, usage }: GroupData): Group[] => [
  {
    id: 'household',
    label: t('settings.groups.household'),
    hidden: young,
    entries: [
      {
        id: 'household',
        label: t('settings.nav.household'),
        hint: t('settings.hints.household'),
        icon: House,
        hidden: profile?.role !== 'admin'
      },
      {
        id: 'profiles',
        label: t('settings.nav.profiles'),
        hint:
          household && profile
            ? `${profile.name} · ${t('count.profile', { count: household.profiles.length })}`
            : t('profiles.who'),
        icon: Users
      },
      {
        id: 'ai',
        label: t('settings.nav.ai'),
        hint: usage
          ? usage.available
            ? t('settings.hints.callsLeft', { count: callsLeft(usage) })
            : t('settings.hints.aiOff')
          : t('settings.hints.ai'),
        icon: 'ai'
      }
    ]
  }
]

// This device, then the server and Hodi itself.
const deviceGroups = ({ t, notifications, household }: GroupData): Group[] => [
  {
    id: 'device',
    label: t('settings.groups.device'),
    entries: [
      {
        id: 'notifications',
        label: t('settings.nav.notifications'),
        hint: t(notifications.enabled ? 'settings.hints.onPlural' : 'settings.hints.offPlural'),
        icon: Bell
      },
      {
        id: 'shortcuts',
        label: t('settings.nav.shortcuts'),
        hint: t('settings.hints.shortcuts'),
        icon: Keyboard,
        desktopOnly: true
      }
    ]
  },
  {
    id: 'about',
    label: t('settings.groups.about'),
    entries: [
      // The server's admin space, for the account that runs it.
      {
        id: 'server',
        href: SERVER_HREF,
        label: t('settings.nav.server'),
        hint: t('settings.hints.server'),
        icon: Server,
        hidden: !household?.serverAdmin
      },
      { id: 'about', label: t('settings.nav.about'), hint: t('settings.hints.about'), icon: Info }
    ]
  }
]

// The sections of the settings, in five groups (what is read, about what, by whom, for the household, here), with what each one holds right now.
export const useGroups = (onUnauthorized: () => void): Group[] => {
  const preferences = usePreferences()
  const notifications = useNotificationSettings()
  const sources = useSourceStatuses(onUnauthorized).value
  const usage = useAiUsage(onUnauthorized).value
  const household = useProfiles({ onError: () => {} })
  const profile = household?.profiles.find(entry => entry.id === household.current)
  // As the "En erreur" filter of Réglages › Sources: a hidden source's error is not this profile's concern.
  const failing =
    sources?.filter(source => sourceState(source) === 'error' && !preferences.hiddenSources.includes(source.id))
      .length ?? 0
  const { t } = useTranslation()
  // A young profile's settings are its own: the household's (Foyer, Profils, IA) are its parents'.
  const young = profile ? isYoung(profile) : false
  const asked = useMyRequests(profile?.kind === 'teen')?.length ?? 0
  const { plugins, web } = usePlugins()

  const data = { t, preferences, notifications, sources, usage, household, profile, failing, asked, young }
  const groups = [...readingGroups(data), ...yourGroups(data), ...householdGroups(data), ...deviceGroups(data)]
  // Plugins' own pages, where their manifests place them.
  return placePlugins(groups, menuPlugins(plugins, web), ({ id }) =>
    pluginEntry(
      plugins.find(plugin => plugin.id === id)!,
      web.get(id)!
    )
  )
}

const pluginEntry = (plugin: PluginInfo, web: WebPlugin): Entry => {
  const Hint = web.menuHint
  return {
    id: `plugin:${plugin.id}`,
    href: pluginPageHref(plugin.id),
    label: pluginName(plugin),
    // Drawn by the plugin, in its slot: an error there leaves its description.
    hint: Hint ? (
      <PluginSlot id={plugin.id} component={Hint} fallback={pluginDescription(plugin)} />
    ) : (
      pluginDescription(plugin)
    ),
    icon: web.menuIcon ?? Puzzle
  }
}
