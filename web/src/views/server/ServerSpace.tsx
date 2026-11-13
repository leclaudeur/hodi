import { Puzzle } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction, i18n as I18n } from 'i18next'
import { useIsServerAdmin } from '../../lib/profiles.ts'
import { useIsDesktop } from '../../lib/use-media.ts'
import {
  type ServerSection,
  FRONT_PAGE_HREF,
  SERVER_HREF,
  SERVER_SECTIONS,
  serverHref
} from '../../lib/use-hash-route.ts'
import { serverPluginGroups } from '../../plugins/menu.ts'
import PluginSlot from '../../plugins/PluginSlot.tsx'
import { pluginNamespace, usePlugins } from '../../plugins/registry.ts'
import EmptyState from '../../ui/EmptyState.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import homeStyles from '../../pages/HomePage.module.css'
import ScrollArea from '../../ui/ScrollArea.tsx'
import MobilePage from '../MobilePage.tsx'
import PluginsSection from '../settings/sections/plugins/PluginsSection.tsx'
import { ServerHome, ServerSidebar, serverPluginKey } from './ServerNav.tsx'
import ServerBackups from './ServerBackups.tsx'
import ServerContent from './ServerContent.tsx'
import ServerMail from './ServerMail.tsx'
import ServerOverview from './ServerOverview.tsx'
import AccountPage from './AccountPage.tsx'
import HouseholdPage from './HouseholdPage.tsx'
import PeopleList from './PeopleList.tsx'
import { type People, type PeopleKind, firstOf, titleOf, usePeople } from './server-people.ts'
import { useTwoFactorOn } from '../../lib/two-factor.ts'
import ServerTwoFactor from './ServerTwoFactor.tsx'
import { pluginName } from '../../plugins/plugin-texts.ts'

type Layout = 'desktop' | 'phone'

// The sections that list things: a column of them beside the open one on a computer.
const isList = (section: ServerSection): section is PeopleKind => section === 'households' || section === 'accounts'

const Page = ({ section, item, layout }: { section: ServerSection; item?: string; layout: Layout }) => {
  switch (section) {
    case 'overview':
      return <ServerOverview layout={layout} />
    case 'backups':
      return <ServerBackups layout={layout} />
    case 'content':
      return <ServerContent layout={layout} />
    case 'mail':
      return <ServerMail layout={layout} />
    case 'households':
      return item ? <HouseholdPage id={item} layout={layout} /> : null
    case 'accounts':
      return item ? <AccountPage id={item} layout={layout} /> : null
    default:
      return <PluginsSection key={`${section}-${item ?? ''}`} item={item} layout={layout} />
  }
}

type PluginSectionRoute = { id: string; section: string; path: string }

// A plugin's own section of the space: the plugin draws all of it, title included, with the SDK's SectionPage. Turned
// off, removed or broken, the address says so instead.
const PluginSectionPage = ({ route, layout }: { route: PluginSectionRoute; layout: Layout }) => {
  const { t } = useTranslation()
  const { plugins, web } = usePlugins()
  const group = serverPluginGroups(plugins, web).find(entry => entry.plugin.id === route.id)
  const section = group?.sections.find(entry => entry.id === route.section)

  const missing = (title: string, failed: boolean) => (
    <SectionPage title={title} layout={layout}>
      <EmptyState
        icon={<Puzzle size={20} />}
        title={t(failed ? 'plugins.pageFailedTitle' : 'plugins.pageMissingTitle')}
      >
        {t(failed ? 'plugins.pageFailedText' : 'plugins.pageMissingText')}
      </EmptyState>
    </SectionPage>
  )
  if (!group || !section) return missing(group ? pluginName(group.plugin) : t('server.titles.plugins'), false)
  return (
    <PluginSlot
      id={route.id}
      component={section.page}
      props={{ layout }}
      fallback={missing(pluginName(group.plugin), true)}
    />
  )
}

// The plain functions below draw the space's levels. Not components: the sidebar and the columns stay the same
// elements from one section to the next.
type Plugins = ReturnType<typeof usePlugins>

// A plugin section's title on a phone: its label in the plugin's own texts, else the plugin's name.
const pluginTitle = (
  route: PluginSectionRoute,
  plugins: Plugins['plugins'],
  web: Plugins['web'],
  t: TFunction,
  i18n: I18n
): string => {
  const group = serverPluginGroups(plugins, web).find(entry => entry.plugin.id === route.id)
  const label = group?.sections.find(entry => entry.id === route.section)?.label
  return label
    ? String(i18n.t(label as never, { ns: pluginNamespace(route.id) } as never))
    : group
      ? pluginName(group.plugin)
      : t('server.titles.plugins')
}

const pluginSpace = (route: PluginSectionRoute, isDesktop: boolean, ready: boolean, title: string, t: TFunction) => {
  // Its page waits for the plugins to load, rather than saying for a moment that it is missing.
  const page = ready ? (
    <PluginSectionPage key={route.section} route={route} layout={isDesktop ? 'desktop' : 'phone'} />
  ) : null
  if (isDesktop)
    return (
      <div className={homeStyles.desktop}>
        <ServerSidebar active={serverPluginKey(route.id, route.section)} />
        <main className={homeStyles.main}>
          <ScrollArea className={homeStyles.panel}>{page}</ScrollArea>
        </main>
      </div>
    )
  return (
    <MobilePage title={title} backHref={SERVER_HREF} backLabel={t('server.backToServer')}>
      {page}
    </MobilePage>
  )
}

const desktopSpace = (section: ServerSection | null, item: string | undefined, people: People | null) => {
  const open = section ?? SERVER_SECTIONS[0]
  // A list opens its first entry beside it until another is chosen.
  const shown = isList(open) ? (item ?? firstOf(open, people)) : item
  return (
    <div className={homeStyles.desktop}>
      <ServerSidebar active={open} />
      {isList(open) && <PeopleList kind={open} active={shown} />}
      <main className={homeStyles.main}>
        <ScrollArea className={homeStyles.panel}>
          <Page key={`${open}-${shown ?? ''}`} section={open} item={shown} layout="desktop" />
        </ScrollArea>
      </main>
    </div>
  )
}

const phoneSpace = (
  section: ServerSection | null,
  item: string | undefined,
  people: People | null,
  plugins: Plugins['plugins'],
  t: TFunction
) => {
  if (!section) return <ServerHome />
  if (isList(section)) {
    if (!item) return <PeopleList kind={section} />
    return (
      <MobilePage
        title={titleOf(section, item, people)}
        backHref={serverHref(section)}
        backLabel={t(section === 'households' ? 'server.people.backToHouseholds' : 'server.people.backToAccounts')}
      >
        <Page section={section} item={item} layout="phone" />
      </MobilePage>
    )
  }
  // A plugin's page goes back to the plugins; a section, to the server's first level.
  const plugin = item ? plugins.find(entry => entry.id === item) : undefined
  return (
    <MobilePage
      title={item ? (plugin?.name ?? t(`server.titles.${section}`)) : t(`server.titles.${section}`)}
      backHref={item ? serverHref(section) : SERVER_HREF}
      backLabel={item ? t('plugins.back') : t('server.backToServer')}
    >
      <Page section={section} item={item} layout="phone" />
    </MobilePage>
  )
}

// The server's admin space, for the account that runs it: none of the app and no profile. On a computer the app's
// columns with the server's own sidebar; on a phone or a tablet held upright, levels as Réglages, without the tab bar.
const ServerSpace = ({
  section,
  item,
  pluginSection
}: {
  section: ServerSection | null
  item?: string
  pluginSection?: PluginSectionRoute
}) => {
  const { t, i18n } = useTranslation()
  const isDesktop = useIsDesktop()
  const serverAdmin = useIsServerAdmin()
  // Required for the server's account: /server opens once it is on.
  const twoFactor = useTwoFactorOn()
  const { ready, plugins, web } = usePlugins()
  const { people } = usePeople(false)

  // Anyone else is sent back to the app: the server refuses them its routes anyway.
  useEffect(() => {
    if (serverAdmin === false) window.location.replace(FRONT_PAGE_HREF)
  }, [serverAdmin])
  if (!serverAdmin) return null
  if (!twoFactor) return <ServerTwoFactor />

  if (pluginSection) {
    const title = pluginTitle(pluginSection, plugins, web, t, i18n)
    return pluginSpace(pluginSection, isDesktop, ready, title, t)
  }
  if (isDesktop) return desktopSpace(section, item, people)
  return phoneSpace(section, item, people, plugins, t)
}

export default ServerSpace
