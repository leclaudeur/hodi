import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicInfo } from '../../api.ts'
import { useProfiles } from '../../lib/profiles.ts'
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

// One section of the settings: beside their list on a computer, its own page on a phone.
const SettingsPanel = ({ section, item, topics, layout, onUnauthorized }: SettingsPanelProps) => {
  const { t } = useTranslation()
  const household = useProfiles({ onError: () => {} })
  // A young profile's page, for its parents: under Profils, back to it.
  const youngId = section === 'profiles' && item && /^\d+$/.test(item) ? Number(item) : null
  // The themes' list while the topics come.
  const waiting = (
    <SectionPage title={t('settings.titles.themes')} intro={t('settings.themes.intro')} layout={layout}>
      <RowsSkeleton rows={6} lead="theme" hint={false} end="toggle" />
    </SectionPage>
  )
  const content =
    youngId !== null ? (
      <YoungProfileSection id={youngId} layout={layout} />
    ) : section === 'reading' ? (
      <ReadingSection layout={layout} />
    ) : section === 'themes' ? (
      topics ? (
        <ThemesSection topics={topics} layout={layout} />
      ) : (
        waiting
      )
    ) : section === 'sources' ? (
      <SourcesSection topics={topics ?? []} layout={layout} onUnauthorized={onUnauthorized} />
    ) : section === 'followed' ? (
      <FollowedSection layout={layout} onUnauthorized={onUnauthorized} />
    ) : section === 'muted' ? (
      <MutedSection layout={layout} />
    ) : section === 'notifications' ? (
      <NotificationsSection layout={layout} onUnauthorized={onUnauthorized} />
    ) : section === 'me' ? (
      <MeSection layout={layout} />
    ) : section === 'stats' ? (
      <Suspense fallback={<StatsSkeleton layout={layout} />}>
        <StatsSection topics={topics ?? []} layout={layout} />
      </Suspense>
    ) : section === 'ai' ? (
      <AiSection layout={layout} onUnauthorized={onUnauthorized} />
    ) : section === 'household' ? (
      <HouseholdSection layout={layout} onUnauthorized={onUnauthorized} />
    ) : section === 'profiles' ? (
      <ProfilesSection layout={layout} />
    ) : section === 'sharing' ? (
      <SharingSection layout={layout} />
    ) : section === 'account' ? (
      <AccountSection layout={layout} />
    ) : section === 'about' ? (
      <AboutSection layout={layout} />
    ) : (
      <ShortcutsSection layout={layout} />
    )

  if (layout === 'phone')
    return (
      <MobilePage
        title={
          youngId !== null
            ? (household?.profiles.find(profile => profile.id === youngId)?.name ?? t('settings.titles.profiles'))
            : t(`settings.titles.${section}`)
        }
        backHref={youngId !== null ? settingsHref('profiles') : SETTINGS_HREF}
        backLabel={youngId !== null ? t('young.backToProfiles') : t('nav.backToSettings')}
      >
        {content}
      </MobilePage>
    )

  return content
}

export default SettingsPanel
