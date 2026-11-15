import { type ReactNode, Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicInfo } from '../../api.ts'
import { useProfiles } from '../../lib/profiles.ts'
import { usePlugins } from '../../plugins/registry.ts'
import { SETTINGS_HREF, type SettingsSection, settingsHref } from '../../lib/use-hash-route.ts'
import MobilePage from '../MobilePage.tsx'
import SectionPage from './SectionPage.tsx'
import RowsSkeleton from './SettingsSkeleton.tsx'
import AboutSection from './sections/AboutSection.tsx'
import AccountSection from './sections/AccountSection.tsx'
import AiSection from './sections/AiSection.tsx'
import FollowedSection from './sections/FollowedSection.tsx'
import HouseholdSection from './sections/HouseholdSection.tsx'
import MeSection from './sections/MeSection.tsx'
import MutedSection from './sections/MutedSection.tsx'
import NotificationsSection from './sections/NotificationsSection.tsx'
import ProfilesSection from './sections/ProfilesSection.tsx'
import ReadingSection from './sections/ReadingSection.tsx'
import SharingSection from './sections/SharingSection.tsx'
import ShortcutsSection from './sections/ShortcutsSection.tsx'
import SourcesSection from './sections/SourcesSection.tsx'
import StatsSkeleton from './sections/StatsSkeleton.tsx'
import ThemesSection from './sections/ThemesSection.tsx'
import YoungProfileSection from './sections/YoungProfileSection.tsx'
import PluginPage from './sections/plugins/PluginPage.tsx'

// The chart library loads with the stats only.
const StatsSection = lazy(() => import('./sections/StatsSection.tsx'))

interface SettingsPanelProps {
  section: SettingsSection
  // One thing of the section: a young profile's id in Profils.
  item?: string
  topics: TopicInfo[] | null
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// A section's own page, by its address. A plain function rather than a component: the panel's tree stays the same.
const sectionContent = ({ section, item, topics, layout, onUnauthorized }: SettingsPanelProps, waiting: ReactNode) => {
  switch (section) {
    case 'reading':
      return <ReadingSection layout={layout} />
    case 'themes':
      return topics ? <ThemesSection topics={topics} layout={layout} /> : waiting
    case 'sources':
      return <SourcesSection topics={topics ?? []} layout={layout} onUnauthorized={onUnauthorized} />
    case 'followed':
      return <FollowedSection layout={layout} onUnauthorized={onUnauthorized} />
    case 'muted':
      return <MutedSection layout={layout} />
    case 'notifications':
      return <NotificationsSection layout={layout} onUnauthorized={onUnauthorized} />
    case 'me':
      return <MeSection layout={layout} />
    case 'stats':
      return (
        <Suspense fallback={<StatsSkeleton layout={layout} />}>
          <StatsSection topics={topics ?? []} layout={layout} />
        </Suspense>
      )
    case 'ai':
      return <AiSection layout={layout} onUnauthorized={onUnauthorized} />
    case 'plugin':
      return <PluginPage key={item ?? ''} id={item ?? ''} layout={layout} />
    case 'household':
      return <HouseholdSection layout={layout} onUnauthorized={onUnauthorized} />
    case 'profiles':
      return <ProfilesSection layout={layout} />
    case 'sharing':
      return <SharingSection layout={layout} />
    case 'account':
      return <AccountSection layout={layout} onUnauthorized={onUnauthorized} />
    case 'about':
      return <AboutSection layout={layout} />
    default:
      return <ShortcutsSection layout={layout} />
  }
}

// One section of the settings: beside their list on a computer, its own page on a phone.
const SettingsPanel = ({ section, item, topics, layout, onUnauthorized }: SettingsPanelProps) => {
  const { t } = useTranslation()
  const household = useProfiles({ onError: () => {} })
  // A young profile's page, for its parents: under Profils, back to it.
  const youngId = section === 'profiles' && item && /^\d+$/.test(item) ? Number(item) : null
  // A plugin's own page: its entry where its manifest puts it, back to Réglages.
  const pagePluginId = section === 'plugin' && item ? item : null
  const { plugins } = usePlugins()
  const plugin = plugins.find(entry => entry.id === pagePluginId)
  // The themes' list while the topics come.
  const waiting = (
    <SectionPage title={t('settings.titles.themes')} intro={t('settings.themes.intro')} layout={layout}>
      <RowsSkeleton rows={6} lead="theme" hint={false} end="toggle" />
    </SectionPage>
  )
  const content =
    youngId !== null ? (
      <YoungProfileSection id={youngId} layout={layout} />
    ) : (
      sectionContent({ section, item, topics, layout, onUnauthorized }, waiting)
    )

  const titleOf = () => {
    if (youngId !== null)
      return household?.profiles.find(profile => profile.id === youngId)?.name ?? t('settings.titles.profiles')
    if (pagePluginId !== null) return plugin?.name ?? t('settings.titles.plugins')
    return t(`settings.titles.${section}`)
  }

  if (layout === 'phone')
    return (
      <MobilePage
        title={titleOf()}
        backHref={youngId !== null ? settingsHref('profiles') : SETTINGS_HREF}
        backLabel={youngId !== null ? t('young.backToProfiles') : t('nav.backToSettings')}
      >
        {content}
      </MobilePage>
    )

  return content
}

export default SettingsPanel
