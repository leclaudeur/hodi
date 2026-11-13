import { Code, Heart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SOURCE_URL, SUPPORT_URL } from '../../../api.ts'
import Button from '../../../ui/Button.tsx'
import Chip from '../../../ui/Chip.tsx'
import SectionPage from '../SectionPage.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

// Who made Hodi and with what: the images, icons and fonts are credited with their licence.
const PEOPLE = ['antho', 'claude', 'gptImage', 'lucide', 'fonts'] as const

// Réglages › À propos: the version, the code (the AGPL's promise: whoever uses Hodi can read it), the way to support
// it, the credits.
const AboutSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()

  return (
    <SectionPage title={t('settings.titles.about')} intro={t('settings.about.intro')} layout={layout}>
      <h2 className={styles.label}>{t('settings.about.app')}</h2>
      <div className={styles.card}>
        {/* The number at the row's end, where every other row keeps what it shows. */}
        <SettingRow label={t('settings.about.version')} hint={t('settings.about.versionHint')}>
          <Chip tone="success" size="row">
            {__APP_VERSION__}
          </Chip>
        </SettingRow>
        <SettingRow label={t('settings.about.licence')} hint={t('settings.about.licenceHint')}>
          <Button icon={Code} href={SOURCE_URL} external>
            {t('settings.about.source')}
          </Button>
        </SettingRow>
        <SettingRow label={t('settings.about.support')} hint={t('settings.about.supportHint')}>
          <Button icon={Heart} href={SUPPORT_URL} external>
            {t('settings.about.supportButton')}
          </Button>
        </SettingRow>
      </div>

      <h2 className={styles.label}>{t('settings.about.credits')}</h2>
      <div className={styles.card}>
        {PEOPLE.map(id => (
          <SettingRow
            key={id}
            label={t(`settings.about.people.${id}.name`)}
            hint={t(`settings.about.people.${id}.role`)}
          />
        ))}
      </div>
    </SectionPage>
  )
}

export default AboutSection
