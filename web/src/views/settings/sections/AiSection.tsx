import { KeyRound, MapPin, RotateCcw, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AiKind,
  type AiUsage,
  type Household,
  type KeyCheck,
  type Profile,
  UnauthorizedError,
  checkAiKey,
  getAiUsage,
  removeHouseholdAi,
  resetAiUsage,
  setHouseholdAi,
  updateHousehold
} from '../../../api.ts'
import { refreshAiUsage } from '../../../lib/ai-left.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { useProfiles } from '../../../lib/profiles.ts'
import { countryName } from '../../../lib/regions.ts'
import { useAiUsage, useHousehold } from '../../../lib/settings-data.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import Accordion, { AccordionGroup } from '../../../ui/Accordion.tsx'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import ProfileAvatar from '../../../ui/ProfileAvatar.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import SparkleIcon from '../../../ui/SparkleIcon.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import AiKeyField from '../../household/AiKeyField.tsx'
import householdStyles from '../../household/Household.module.css'
import { CountryPicker } from '../../household/RegionPickers.tsx'
import RichText from '../../../ui/RichText.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import aiStyles from './AiSection.module.css'

interface UsageRow {
  kind: AiKind
  used: number
  limit: number
}

// One kind's calls against its cap; the admin's red round puts it back to 0. Flat: the rows straight in an
// accordion, one line between each, no card in the card.
const UsageRows = ({
  rows,
  onReset,
  flat = false
}: {
  rows: UsageRow[]
  onReset?: (kind: AiKind) => void
  flat?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <ul className={flat ? aiStyles.flat : styles.card}>
      {rows.map(({ kind, used, limit }) => (
        <li key={kind} className={styles.row}>
          <span className={styles.rowText}>
            {/* Each title names the button that spends the call, so no line under it is needed. */}
            <span className={styles.rowLabel}>{t(`ai.kinds.${kind}`)}</span>
            <span className={aiStyles.track} aria-hidden="true">
              <span
                className={aiStyles.fill}
                style={{ width: `${limit > 0 ? Math.min(100, (used / limit) * 100) : 0}%` }}
              />
            </span>
          </span>
          <span className={aiStyles.count}>
            <strong>{used}</strong> / {limit}
          </span>
          {onReset && (
            <RoundButton
              icon={RotateCcw}
              label={t('ai.resetKindLabel', { kind: t(`ai.kinds.${kind}`) })}
              size={34}
              disabled={used === 0}
              onClick={() => onReset(kind)}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

// A new key, checked on "Vérifier" (no credits spent), kept only once its provider took it.
const AiKeyDialog = ({
  household,
  onSaved,
  onClose,
  onUnauthorized
}: {
  household: Household
  onSaved: (next: Household) => void
  onClose: () => void
  onUnauthorized: () => void
}) => {
  const { t } = useTranslation()
  const provider =
    household.providers.find(candidate => candidate.id === household.ai?.provider) ?? household.providers[0]
  const [key, setKey] = useState('')
  const [result, setResult] = useState<KeyCheck | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!provider) return
    setSaving(true)
    setFailed(false)
    try {
      onSaved(await setHouseholdAi(provider.id, key.trim()))
      onClose()
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized()
      else setFailed(true)
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(household.ai ? 'ai.replaceKey' : 'ai.turnOn')}
      intro={<RichText i18nKey={household.ai ? 'dialogIntro.aiReplace' : 'dialogIntro.aiTurnOn'} />}
    >
      <form className={householdStyles.form} onSubmit={submit}>
        {provider && (
          <AiKeyField
            provider={provider}
            value={key}
            onChange={setKey}
            result={result}
            onResult={setResult}
            check={checkAiKey}
            onUnauthorized={onUnauthorized}
          />
        )}
        {failed && <StatusLine tone="error">{t('ai.keyFailed')}</StatusLine>}
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" look="primary" busy={saving} disabled={result !== 'ok'}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
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
  const household = useProfiles({ onError: () => {} })
  const profiles = household?.profiles ?? []
  const current = profiles.find(profile => profile.id === household?.current)
  const admin = current?.role === 'admin'
  const settings = useHousehold(admin ? onUnauthorized : undefined)
  const [editingKey, setEditingKey] = useState(false)
  const [pickingCountry, setPickingCountry] = useState(false)

  // Only the AI's web searches use it, so it lives beside the key.
  const saveCountry = (country: string | null) =>
    void updateHousehold({ country })
      .then(next => {
        settings.replace(next)
        showSaved()
      })
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
        else showError(t('ai.countryFailed'))
      })

  // The buttons come or go with the key: the calls of the day are read again.
  const keyChanged = (next: Household) => {
    settings.replace(next)
    void getAiUsage()
      .then(replace)
      .catch(() => {})
    void refreshAiUsage()
    showSaved(t(next.ai ? 'ai.on' : 'ai.removed'))
  }

  const removeKey = () =>
    askToConfirm({
      title: t('confirm.removeKey.title'),
      message: <RichText i18nKey="confirm.removeKey.message" />,
      label: t('confirm.removeKey.button'),
      onConfirm: () =>
        void removeHouseholdAi()
          .then(keyChanged)
          .catch((error: unknown) => {
            if (error instanceof UnauthorizedError) onUnauthorized()
            else showError(t('ai.removeFailed'))
          })
    })

  // The admin's: who answers and with which key.
  const provider =
    admin && settings.value ? (
      <>
        <h2 className={styles.label}>{t('ai.provider')}</h2>
        <div className={styles.card}>
          {settings.value.ai ? (
            <>
              <SettingRow
                label={settings.value.ai.providerName}
                hint={t('ai.model', { model: settings.value.ai.model })}
              />
              <SettingRow label={t('ai.key')} hint={settings.value.ai.keyHint}>
                <div className={aiStyles.keyActions}>
                  <Button icon={KeyRound} onClick={() => setEditingKey(true)}>
                    {t('ai.replace')}
                  </Button>
                  <Button look="danger" icon={Trash2} onClick={removeKey}>
                    {t('ai.remove')}
                  </Button>
                </div>
              </SettingRow>
              <SettingRow label={t('regions.country')} hint={t('ai.countryHint')}>
                <Button icon={MapPin} onClick={() => setPickingCountry(true)}>
                  {settings.value.country ? countryName(settings.value.country) : t('common.none')}
                </Button>
              </SettingRow>
            </>
          ) : (
            <SettingRow
              label={t('ai.off')}
              hint={t('ai.offAdmin')}
              lead={
                <span className={aiStyles.mark}>
                  <SparkleIcon size={18} />
                </span>
              }
            >
              <Button icon={KeyRound} onClick={() => setEditingKey(true)}>
                {t('ai.addKey')}
              </Button>
            </SettingRow>
          )}
        </div>
        <CountryPicker
          open={pickingCountry}
          value={settings.value.country}
          onPick={saveCountry}
          onClose={() => setPickingCountry(false)}
        />
        {editingKey && (
          <AiKeyDialog
            household={settings.value}
            onSaved={keyChanged}
            onClose={() => setEditingKey(false)}
            onUnauthorized={onUnauthorized}
          />
        )}
      </>
    ) : null
  // All closed as the page opens: the profiles' rows are its summary.
  const [opened, setOpened] = useState<number[]>([])

  const toggle = (id: number) => setOpened(ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))

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
        (provider ?? (
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
        ))
      ) : admin ? (
        <>
          {provider}
          <div className={aiStyles.labelRow}>
            <h2 className={styles.label}>{t('ai.householdDay')}</h2>
            <Button
              compact
              icon={RotateCcw}
              disabled={usage.kinds.every(kind => kind.householdUsed === 0)}
              onClick={() => resetHousehold()}
            >
              {t('settings.me.resetAction')}
            </Button>
          </div>
          <UsageRows
            rows={usage.kinds.map(({ kind, householdUsed, householdLimit }) => ({
              kind,
              used: householdUsed,
              limit: householdLimit
            }))}
            onReset={resetHousehold}
          />

          <h2 className={styles.label}>{t('ai.profilesDay')}</h2>
          <AccordionGroup>
            {profiles.map(profile => {
              const own = usage.profiles.find(entry => entry.profileId === profile.id)
              return (
                <Accordion
                  key={profile.id}
                  title={profile.name}
                  lead={<ProfileAvatar profile={profile} size={44} />}
                  open={opened.includes(profile.id)}
                  onToggle={() => toggle(profile.id)}
                  action={
                    <Button
                      compact
                      icon={RotateCcw}
                      disabled={!own || own.kinds.every(kind => kind.used === 0)}
                      onClick={() => resetProfile(profile)}
                    >
                      {t('settings.me.resetAction')}
                    </Button>
                  }
                >
                  <UsageRows rows={own?.kinds ?? []} onReset={kind => resetProfile(profile, kind)} flat />
                </Accordion>
              )
            })}
          </AccordionGroup>
        </>
      ) : (
        <>
          <h2 className={styles.label}>{current ? t('ai.yoursOf', { name: current.name }) : t('ai.yours')}</h2>
          <UsageRows rows={usage.kinds} />
        </>
      )}
    </SectionPage>
  )
}

export default AiSection
