import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicInfo } from '../../api.ts'
import { usePlugins } from '../../plugins/registry.ts'
import { SETTINGS_HREF, type SettingsSection } from '../../lib/use-hash-route.ts'
import MobilePage from '../MobilePage.tsx'
import SectionPage from './SectionPage.tsx'
import RowsSkeleton from './SettingsSkeleton.tsx'
import AboutSection from './sections/AboutSection.tsx'
import FollowedSection from './sections/FollowedSection.tsx'
import GeneralSection from './sections/GeneralSection.tsx'
import MutedSection from './sections/MutedSection.tsx'
import NotificationsSection from './sections/NotificationsSection.tsx'
import ReadingSection from './sections/ReadingSection.tsx'
import SharingSection from './sections/SharingSection.tsx'
import ShortcutsSection from './sections/ShortcutsSection.tsx'
import SourcesSection from './sections/SourcesSection.tsx'
import ThemesSection from './sections/ThemesSection.tsx'
import PluginPage from './sections/plugins/PluginPage.tsx'

interface SettingsPanelProps {
  section: SettingsSection
  // One thing of the section: a plugin's id.
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
    case 'general':
      return <GeneralSection layout={layout} />
    case 'plugin':
      return <PluginPage key={item ?? ''} id={item ?? ''} layout={layout} />
    case 'sharing':
      return <SharingSection layout={layout} />
    case 'about':
      return <AboutSection layout={layout} />
    default:
      return <ShortcutsSection layout={layout} />
  }
}

// One section of the settings: beside their list on a computer, its own page on a phone.
const SettingsPanel = ({ section, item, topics, layout, onUnauthorized }: SettingsPanelProps) => {
  const { t } = useTranslation()
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
  const content = sectionContent({ section, item, topics, layout, onUnauthorized }, waiting)

  const titleOf = () => {
    if (pagePluginId !== null) return plugin?.name ?? t('settings.titles.plugins')
    return t(`settings.titles.${section}`)
  }

  if (layout === 'phone')
    return (
      <MobilePage title={titleOf()} backHref={SETTINGS_HREF} backLabel={t('nav.backToSettings')}>
        {content}
      </MobilePage>
    )

  return content
}

export default SettingsPanel
