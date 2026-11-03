import { ChartColumn, Inbox, Layers, Moon, Rss, Sun, Timer, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type ProfileKind,
  type YouthCatalogueTopic,
  type YouthLimits,
  type YouthTopic,
  type YouthWeek,
  getYouthRules,
  getYouthSources,
  getYouthTopics,
  getYouthWeek
} from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { editProfile, isYoung, removeProfile, useProfiles } from '../../../lib/profiles.ts'
import { usePendingRequests } from '../../../lib/requests.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import { requestHref, settingsHref } from '../../../lib/use-hash-route.ts'
import Button from '../../../ui/Button.tsx'
import Chip from '../../../ui/Chip.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import ProfileAvatarButton from '../../../ui/ProfileAvatarButton.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import ProfileForm from '../../profiles/ProfileForm.tsx'
import RichText from '../../../ui/RichText.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import { DailyDialog, ExplainDialog, RangeDialog } from './young/RulesDialogs.tsx'
import SourcesDialog from './young/SourcesDialog.tsx'
import TopicsDialog from './young/TopicsDialog.tsx'
import WeekDialog from './young/WeekDialog.tsx'
import { formatMinutes, formatRange } from './young/format.ts'

type Opened = 'edit' | 'sources' | 'topics' | 'daily' | 'window' | 'quiet' | 'explain' | 'week'

interface Loaded {
  limits: YouthLimits
  sources: YouthCatalogueTopic[]
  topics: YouthTopic[]
  week: YouthWeek
}

// Réglages > Profils > Gérer: a young profile's page, for its parents. What it reads (sources, themes), when and how
// long (time per day, hours, quiet hours), its AI explanations, and its week. Every change happens in a dialog.
const YoungProfileSection = ({ id, layout }: { id: number; layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const value = useProfiles({ fresh: true })
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [opened, setOpened] = useState<Opened | null>(null)
  const profile = value?.profiles.find(entry => entry.id === id)
  const own = value?.profiles.find(entry => entry.id === value.current)
  const admin = own?.role === 'admin'
  const young = profile && isYoung(profile)
  // A teen asks for sources: what it asked waits here too, as on top of Réglages.
  const asked = usePendingRequests(profile?.kind === 'teen').filter(request => request.profileId === id)
  const oldest = asked.at(-1)

  useEffect(() => {
    if (!young) return
    let cancelled = false
    Promise.all([getYouthRules(id), getYouthSources(id), getYouthTopics(id), getYouthWeek(id)])
      .then(([limits, sources, topics, week]) => {
        if (!cancelled) setLoaded({ limits, sources, topics, week })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, young])

  const title = profile?.name ?? t('young.manage')

  // Gone, or not a young one (an address typed by hand): back to the list.
  if (value && (!profile || !young))
    return (
      <SectionPage title={title} layout={layout}>
        <StatusLine tone="info">{t('young.notFound')}</StatusLine>
        <Button href={settingsHref('profiles')}>{t('common.back')}</Button>
      </SectionPage>
    )

  if (!profile || !loaded)
    return (
      <SectionPage title={title} layout={layout}>
        {failed ? (
          <StatusLine tone="error">{t('young.loadFailed')}</StatusLine>
        ) : (
          <>
            <RowsSkeleton rows={1} lead="round" end="button" />
            <RowsSkeleton rows={2} lead="none" end="button" />
            <RowsSkeleton rows={3} lead="none" end="button" />
          </>
        )}
      </SectionPage>
    )

  const { rules } = loaded.limits
  const name = profile.name
  const close = () => setOpened(null)
  const saveLimits = (limits: YouthLimits) => {
    setLoaded(previous => previous && { ...previous, limits })
    close()
  }
  const sourcesOn = loaded.sources.flatMap(topic => topic.sources.filter(source => source.on))
  const topicsWithSources = loaded.sources.filter(topic => topic.sources.some(source => source.on)).length
  const visible = loaded.topics.filter(topic => topic.on).length
  const weekMinutes = Math.round(loaded.week.days.reduce((sum, day) => sum + day.seconds, 0) / 60)
  const kinds: ProfileKind[] = admin ? ['adult', 'teen', 'child'] : ['teen', 'child']
  const labels = new Map(loaded.topics.map(topic => [topic.id, topic.label]))

  const remove = () =>
    askToConfirm({
      title: t('confirm.deleteProfile.title'),
      message: <RichText i18nKey="confirm.deleteProfile.message" values={{ name }} />,
      label: t('confirm.deleteProfile.button'),
      onConfirm: () => {
        // Asked over its form: the form goes with the profile.
        close()
        void removeProfile(id)
          .then(() => {
            showSaved(t('young.deleted', { name }))
            window.location.hash = settingsHref('profiles')
          })
          .catch(() => showError(t('young.deleteFailed')))
      }
    })

  // A row and the button that opens its dialog.
  const row = (label: string, hint: ReactNode, icon: typeof Rss | undefined, value: ReactNode, open: Opened) => (
    <SettingRow label={label} hint={hint}>
      <Button icon={icon} onClick={() => setOpened(open)}>
        {value}
      </Button>
    </SettingRow>
  )

  const dialogs: Record<Opened, { title: string; intro: ReactNode; body: ReactNode; size?: 'compact' | 'wide' }> = {
    edit: {
      title: t('settings.editProfileTitle'),
      intro: null,
      body: (
        <ProfileForm
          profile={profile}
          kinds={kinds}
          onCancel={close}
          // As for an adult's profile: only the admin deletes one, from its form too. The question comes over the
          // form, which "Retour" brings back.
          onDelete={admin ? remove : undefined}
          onSave={async ({ name: newName, color, photo, kind, avatar }) => {
            await editProfile(id, { name: newName, color, kind, avatar }, photo)
            close()
            showSaved(t('young.profileSaved'))
            // Made an adult: its page is gone.
            if (kind === 'adult') window.location.hash = settingsHref('profiles')
          }}
        />
      )
    },
    sources: {
      title: t('young.sourcesTitle'),
      intro: <RichText i18nKey="dialogIntro.sources" />,
      size: 'wide',
      body: (
        <SourcesDialog
          profileId={id}
          name={name}
          topics={loaded.sources}
          onCancel={close}
          onSaved={sources => {
            setLoaded(previous => previous && { ...previous, sources })
            close()
          }}
        />
      )
    },
    topics: {
      title: t('young.topicsTitle'),
      intro: <RichText i18nKey="dialogIntro.topics" />,
      body: (
        <TopicsDialog
          profileId={id}
          topics={loaded.topics}
          onCancel={close}
          onSaved={topics => {
            setLoaded(previous => previous && { ...previous, topics })
            close()
          }}
        />
      )
    },
    daily: {
      title: t('young.dailyTitle'),
      intro: <RichText i18nKey="dialogIntro.daily" />,
      body: <DailyDialog profileId={id} rules={rules} onCancel={close} onSaved={saveLimits} />
    },
    window: {
      title: t('young.window'),
      intro: <RichText i18nKey="dialogIntro.window" />,
      body: <RangeDialog profileId={id} rules={rules} rule="window" onCancel={close} onSaved={saveLimits} />
    },
    quiet: {
      title: t('young.quiet'),
      intro: <RichText i18nKey="dialogIntro.quiet" />,
      body: <RangeDialog profileId={id} rules={rules} rule="quiet" onCancel={close} onSaved={saveLimits} />
    },
    explain: {
      title: t('young.explainTitle'),
      intro: <RichText i18nKey="dialogIntro.explain" values={{ name }} />,
      body: <ExplainDialog profileId={id} rules={rules} onCancel={close} onSaved={saveLimits} />
    },
    week: {
      title: t('young.weekTitle'),
      intro: <RichText i18nKey="dialogIntro.week" />,
      size: 'wide',
      body: <WeekDialog week={loaded.week} labels={labels} color={profile.color} />
    }
  }
  const dialog = opened ? dialogs[opened] : null

  return (
    <SectionPage title={name} layout={layout}>
      <div className={styles.card}>
        <div className={styles.row}>
          <ProfileAvatarButton profile={profile} size={44} />
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>{name}</span>
            <span className={styles.rowHint}>
              {rules.dailyMinutes === null
                ? t('young.noLimit')
                : t('young.perDay', { time: formatMinutes(rules.dailyMinutes) })}
            </span>
          </span>
          <Chip size="row">{t(`profileForm.kinds.${profile.kind}`)}</Chip>
          <Button compact onClick={() => setOpened('edit')} aria-label={t('young.editTitle', { name })}>
            {t('young.edit')}
          </Button>
        </div>
      </div>

      <h2 className={styles.label}>{t('young.reading')}</h2>
      <div className={styles.card}>
        {row(
          t('young.sources'),
          sourcesOn.length === 0
            ? t('young.sourcesNone')
            : t('young.sourcesHint', {
                sources: t('count.source', { count: sourcesOn.length }),
                topics: t('young.topicCount', { count: topicsWithSources })
              }),
          Rss,
          t('young.manage'),
          'sources'
        )}
        {row(
          t('young.topics'),
          t('young.topicsHint', { name }),
          Layers,
          t('young.visible', { count: visible }),
          'topics'
        )}
        {profile.kind === 'teen' && (
          <SettingRow
            label={t('requests.fiche')}
            hint={asked.length ? t('requests.waiting', { count: asked.length }) : t('requests.ficheNone')}
          >
            {/* The oldest first, as in the pile. */}
            {oldest && (
              <Button icon={Inbox} href={requestHref(oldest.id)}>
                {t('requests.see')}
              </Button>
            )}
          </SettingRow>
        )}
      </div>

      <h2 className={styles.label}>{t('young.time')}</h2>
      <div className={styles.card}>
        {row(
          t('young.daily'),
          t('young.dailyHint'),
          Timer,
          rules.dailyMinutes === null ? t('young.noLimitShort') : formatMinutes(rules.dailyMinutes),
          'daily'
        )}
        {row(
          t('young.window'),
          t('young.windowHint', { name }),
          Sun,
          rules.window ? formatRange(rules.window) : t('young.windowAll'),
          'window'
        )}
        {row(
          t('young.quiet'),
          t('young.quietHint'),
          Moon,
          rules.quiet ? formatRange(rules.quiet) : t('young.quietNone'),
          'quiet'
        )}
      </div>

      <h2 className={styles.label}>{t('young.ai')}</h2>
      <div className={styles.card}>
        {row(
          t('young.explain'),
          t('young.explainHint', { name }),
          undefined,
          rules.explainPerDay === 0 ? t('young.explainNone') : t('young.perDayCount', { count: rules.explainPerDay }),
          'explain'
        )}
      </div>

      <h2 className={styles.label}>{t('young.followUp')}</h2>
      <div className={styles.card}>
        {row(
          t('young.week'),
          weekMinutes === 0 && loaded.week.articles === 0
            ? t('young.weekNone')
            : t('young.weekHint', {
                time: formatMinutes(weekMinutes),
                articles: t('count.article', { count: loaded.week.articles })
              }),
          ChartColumn,
          t('young.see'),
          'week'
        )}
      </div>

      {/* Only the admin deletes a profile. */}
      {admin && (
        <>
          <h2 className={styles.label}>{t('young.profile')}</h2>
          <div className={styles.card}>
            <SettingRow label={t('young.delete')} hint={t('young.deleteHint')}>
              <Button look="danger" icon={Trash2} onClick={remove}>
                {t('young.deleteButton')}
              </Button>
            </SettingRow>
          </div>
        </>
      )}

      <Dialog
        open={dialog !== null}
        onClose={close}
        title={dialog?.title ?? ''}
        intro={dialog?.intro}
        size={dialog?.size}
      >
        {dialog?.body}
      </Dialog>
    </SectionPage>
  )
}

export default YoungProfileSection
