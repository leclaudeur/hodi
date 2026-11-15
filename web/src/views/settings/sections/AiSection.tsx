import { RotateCcw } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AiKind, type AiUsage, type Profile, UnauthorizedError, resetAiUsage } from '../../../api.ts'
import { usePlugins } from '../../../plugins/registry.ts'
import { refreshAiUsage } from '../../../lib/ai-left.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { useProfiles } from '../../../lib/profiles.ts'
import { useAiUsage, useHousehold } from '../../../lib/settings-data.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import Accordion, { AccordionGroup } from '../../../ui/Accordion.tsx'
import Button from '../../../ui/Button.tsx'
import ProfileAvatar from '../../../ui/ProfileAvatar.tsx'
import SparkleIcon from '../../../ui/SparkleIcon.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import RichText from '../../../ui/RichText.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import aiStyles from './AiSection.module.css'
import { PluginRows, UsageRows } from './AiParts.tsx'
import { ProviderCard, useProviderActions } from './AiProvider.tsx'

// The household's calls and each profile's, put back to 0 by the admin.
const useResets = (replace: (next: AiUsage) => void, onUnauthorized: () => void) => {
  const { t } = useTranslation()
  // Confirmed first, in a dialog: a reset gives back calls paid on the credits.
  const reset = ({
    title,
    message,
    kind,
    profile
  }: {
    title: string
    message: ReactNode
    kind?: AiKind
    profile?: Profile
  }) =>
    askToConfirm({
      title,
      message,
      label: t('confirm.resetHousehold.button'),
      onConfirm: () =>
        void resetAiUsage({ kind, profileId: profile?.id })
          .then((next: AiUsage) => {
            replace(next)
            void refreshAiUsage()
            showSaved(t('ai.resetDone'))
          })
          .catch((error: unknown) => {
            if (error instanceof UnauthorizedError) onUnauthorized()
            else showError(t('ai.resetFailed'))
          })
    })

  const resetHousehold = (kind?: AiKind) =>
    reset({
      ...(kind
        ? {
            title: t('confirm.resetHouseholdKind.title', { kind: t(`confirm.kinds.${kind}`) }),
            message: (
              <RichText i18nKey="confirm.resetHouseholdKind.message" values={{ kind: t(`confirm.kinds.${kind}`) }} />
            )
          }
        : {
            title: t('confirm.resetHousehold.title'),
            message: <RichText i18nKey="confirm.resetHousehold.message" />
          }),
      kind
    })

  const resetProfile = (profile: Profile, kind?: AiKind) =>
    reset({
      ...(kind
        ? {
            title: t('confirm.resetProfileKind.title'),
            message: (
              <RichText
                i18nKey="confirm.resetProfileKind.message"
                values={{ kind: t(`confirm.kinds.${kind}`), name: profile.name }}
              />
            )
          }
        : {
            title: t('confirm.resetProfile.title'),
            message: <RichText i18nKey="confirm.resetProfile.message" values={{ name: profile.name }} />
          }),
      kind,
      profile
    })
  return { resetHousehold, resetProfile }
}

interface ProfilesUsageProps {
  profiles: Profile[]
  usage: AiUsage
  opened: number[]
  onToggle: (id: number) => void
  shown: Shown
  onReset: (profile: Profile, kind?: AiKind) => void
}

// Each profile's calls, in its accordion.
const ProfilesUsage = ({ profiles, usage, opened, onToggle, shown, onReset }: ProfilesUsageProps) => {
  const { t } = useTranslation()
  return (
    <AccordionGroup>
      {profiles.map(profile => {
        const own = usage.profiles.find(entry => entry.profileId === profile.id)
        return (
          <Accordion
            key={profile.id}
            title={profile.name}
            lead={<ProfileAvatar profile={profile} size={44} />}
            open={opened.includes(profile.id)}
            onToggle={() => onToggle(profile.id)}
            action={
              <Button
                icon={RotateCcw}
                disabled={!own || own.kinds.every(kind => kind.used === 0)}
                onClick={() => onReset(profile)}
              >
                {t('settings.me.resetAction')}
              </Button>
            }
          >
            <UsageRows rows={shown(own?.kinds ?? [])} onReset={kind => onReset(profile, kind)} flat />
          </Accordion>
        )
      })}
    </AccordionGroup>
  )
}

// A member's page while the household has no AI.
const AiOff = () => {
  const { t } = useTranslation()
  return (
    <div className={styles.card}>
      <SettingRow
        label={t('ai.off')}
        hint={t('ai.offMember')}
        lead={
          <span className={aiStyles.mark}>
            <SparkleIcon size={18} />
          </span>
        }
      />
    </div>
  )
}

interface HouseholdUsageProps {
  usage: AiUsage
  shown: Shown
  pluginsAsk: boolean
  onReset: (kind?: AiKind) => void
  onUnauthorized: () => void
}

// The household's calls of the day, each kind against its cap, then the plugins'.
const HouseholdUsage = ({ usage, shown, pluginsAsk, onReset, onUnauthorized }: HouseholdUsageProps) => {
  const { t } = useTranslation()
  return (
    <>
      <div className={aiStyles.labelRow}>
        <h2 className={styles.label}>{t('ai.householdDay')}</h2>
        <Button
          icon={RotateCcw}
          disabled={usage.kinds.every(kind => kind.householdUsed === 0)}
          onClick={() => onReset()}
        >
          {t('settings.me.resetAction')}
        </Button>
      </div>
      <UsageRows
        rows={shown(usage.kinds).map(({ kind, householdUsed, householdLimit }) => ({
          kind,
          used: householdUsed,
          limit: householdLimit
        }))}
        onReset={onReset}
      />
      {pluginsAsk && <PluginRows onUnauthorized={onUnauthorized} />}
    </>
  )
}

type Shown = <Row extends { kind: AiKind }>(rows: Row[]) => Row[]

// The plugins' kind only once a plugin of the household has a violet button.
const shownOf =
  (pluginsAsk: boolean): Shown =>
  rows =>
    pluginsAsk ? rows : rows.filter(row => row.kind !== 'plugin')

// All closed as the page opens: the profiles' rows are its summary. One profile open at a time, as every accordion.
const useOneOpen = () => {
  const [opened, setOpened] = useState<number[]>([])
  const toggle = (id: number) => setOpened(ids => (ids.includes(id) ? ids.filter(other => other !== id) : [id]))
  return [opened, toggle] as const
}

// A member's own calls of the day.
const MemberUsage = ({ current, usage, shown }: { current: Profile | undefined; usage: AiUsage; shown: Shown }) => {
  const { t } = useTranslation()
  return (
    <>
      <h2 className={styles.label}>{current ? t('ai.yoursOf', { name: current.name }) : t('ai.yours')}</h2>
      <UsageRows rows={shown(usage.kinds)} />
    </>
  )
}

interface AiSectionProps {
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// The AI calls of the last 24 hours against each daily cap. Every violet button is one call, never automatic.
// A member sees its own calls; the admin sees the household's on top, then each profile's in its accordion, and
// can put any of them back to 0.
const AiSection = ({ layout, onUnauthorized }: AiSectionProps) => {
  const { t } = useTranslation()
  const { value: usage, failed, replace } = useAiUsage(onUnauthorized)
  // The plugins' row only once a plugin of the household has a violet button.
  const pluginsAsk = usePlugins().plugins.some(plugin => plugin.enabled && !plugin.error && plugin.usesAi)
  const shown = shownOf(pluginsAsk)
  const household = useProfiles({ onError: () => {} })
  const profiles = household?.profiles ?? []
  const current = profiles.find(profile => profile.id === household?.current)
  const admin = current?.role === 'admin'
  const settings = useHousehold(admin ? onUnauthorized : undefined)
  const [editingKey, setEditingKey] = useState(false)
  const [pickingCountry, setPickingCountry] = useState(false)

  const { saveCountry, keyChanged, removeKey } = useProviderActions(settings.replace, replace, onUnauthorized)

  // The admin's: who answers and with which key.
  const provider =
    admin && settings.value ? (
      <ProviderCard
        household={settings.value}
        editingKey={editingKey}
        onEditingKey={setEditingKey}
        pickingCountry={pickingCountry}
        onPickingCountry={setPickingCountry}
        onCountry={saveCountry}
        onKeyChanged={keyChanged}
        onRemoveKey={removeKey}
        onUnauthorized={onUnauthorized}
      />
    ) : null
  const [opened, toggle] = useOneOpen()

  const { resetHousehold, resetProfile } = useResets(replace, onUnauthorized)

  return (
    <SectionPage
      title={t('settings.nav.ai')}
      intro={admin ? `${t('ai.intro')} ${t('ai.introAdmin')}` : t('ai.intro')}
      layout={layout}
    >
      {failed ? (
        <StatusLine tone="error">{t('ai.loadFailed')}</StatusLine>
      ) : !usage ? (
        <RowsSkeleton rows={4} />
      ) : !usage.available ? (
        (provider ?? <AiOff />)
      ) : admin ? (
        <>
          {provider}
          <HouseholdUsage
            usage={usage}
            shown={shown}
            pluginsAsk={pluginsAsk}
            onReset={resetHousehold}
            onUnauthorized={onUnauthorized}
          />

          <h2 className={styles.label}>{t('ai.profilesDay')}</h2>
          <ProfilesUsage
            profiles={profiles}
            usage={usage}
            opened={opened}
            onToggle={toggle}
            shown={shown}
            onReset={resetProfile}
          />
        </>
      ) : (
        <MemberUsage current={current} usage={usage} shown={shown} />
      )}
    </SectionPage>
  )
}

export default AiSection
