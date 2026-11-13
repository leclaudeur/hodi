import type { LucideIcon } from 'lucide-react'
import { ChartColumn, Inbox, Layers, Lightbulb, Moon, Pencil, Rss, Sun, Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Profile, SourceRequest } from '../../../../api.ts'
import { requestHref } from '../../../../lib/use-hash-route.ts'
import Chip from '../../../../ui/Chip.tsx'
import ProfileAvatarButton from '../../../../ui/ProfileAvatarButton.tsx'
import SettingRow, { RowButton } from '../../SettingRow.tsx'
import styles from '../../Settings.module.css'
import { formatMinutes, formatRange } from './format.ts'
import type { Loaded, Opened } from './young-load.ts'

interface OpenRowProps {
  label: string
  value: ReactNode
  icon: LucideIcon
  action: string
  onOpen: () => void
}

// A row: what it is set to, and the button that opens its dialog (the dialog explains it).
const OpenRow = ({ label, value, icon, action, onOpen }: OpenRowProps) => (
  <SettingRow label={label} value={value} action={{ label: action, icon, onClick: onOpen }} />
)

interface RowsProps {
  profile: Profile
  loaded: Loaded
  onOpen: (opened: Opened) => void
}

// The profile itself: its photo, its time a day and its type, and changing it.
export const YoungHead = ({ profile, loaded, onOpen }: RowsProps) => {
  const { t } = useTranslation()
  const { rules } = loaded.limits
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <ProfileAvatarButton profile={profile} size={44} />
        <span className={styles.rowText}>
          <span className={styles.rowLabel}>{profile.name}</span>
          <span className={styles.rowHint}>
            {rules.dailyMinutes === null
              ? t('young.noLimit')
              : t('young.perDay', { time: formatMinutes(rules.dailyMinutes) })}
          </span>
        </span>
        <Chip size="row">{t(`profileForm.kinds.${profile.kind}`)}</Chip>
        <RowButton
          label={t('young.edit')}
          ariaLabel={t('young.editTitle', { name: profile.name })}
          icon={Pencil}
          onClick={() => onOpen('edit')}
        />
      </div>
    </div>
  )
}

// What it reads: its sources, its themes, and a teen's requests.
export const ReadingRows = ({ profile, loaded, onOpen, asked }: RowsProps & { asked: SourceRequest[] }) => {
  const { t } = useTranslation()
  const sourcesOn = loaded.sources.flatMap(topic => topic.sources.filter(source => source.on))
  const topicsWithSources = loaded.sources.filter(topic => topic.sources.some(source => source.on)).length
  const visible = loaded.topics.filter(topic => topic.on).length
  const oldest = asked.at(-1)
  return (
    <div className={styles.card}>
      <OpenRow
        label={t('young.sources')}
        value={
          sourcesOn.length === 0
            ? t('young.sourcesNone')
            : t('young.sourcesHint', {
                sources: t('count.source', { count: sourcesOn.length }),
                topics: t('young.topicCount', { count: topicsWithSources })
              })
        }
        icon={Rss}
        action={t('young.manage')}
        onOpen={() => onOpen('sources')}
      />
      <OpenRow
        label={t('young.topics')}
        value={t('young.visible', { count: visible })}
        icon={Layers}
        action={t('young.manage')}
        onOpen={() => onOpen('topics')}
      />
      {profile.kind === 'teen' && (
        <SettingRow
          label={t('requests.fiche')}
          value={asked.length ? t('requests.waiting', { count: asked.length }) : t('requests.ficheNone')}
          // The oldest first, as in the pile.
          action={oldest ? { label: t('requests.see'), icon: Inbox, href: requestHref(oldest.id) } : undefined}
        />
      )}
    </div>
  )
}

// When and how long: its time a day, its hours and its quiet hours.
export const TimeRows = ({ loaded, onOpen }: Omit<RowsProps, 'profile'>) => {
  const { t } = useTranslation()
  const { rules } = loaded.limits
  return (
    <div className={styles.card}>
      <OpenRow
        label={t('young.daily')}
        value={rules.dailyMinutes === null ? t('young.noLimitShort') : formatMinutes(rules.dailyMinutes)}
        icon={Timer}
        action={t('common.change')}
        onOpen={() => onOpen('daily')}
      />
      <OpenRow
        label={t('young.window')}
        value={rules.window ? formatRange(rules.window) : t('young.windowAll')}
        icon={Sun}
        action={t('common.change')}
        onOpen={() => onOpen('window')}
      />
      <OpenRow
        label={t('young.quiet')}
        value={rules.quiet ? formatRange(rules.quiet) : t('young.quietNone')}
        icon={Moon}
        action={t('common.change')}
        onOpen={() => onOpen('quiet')}
      />
    </div>
  )
}

// Its AI explanations a day.
export const AiRows = ({ loaded, onOpen }: Omit<RowsProps, 'profile'>) => {
  const { t } = useTranslation()
  const { explainPerDay } = loaded.limits.rules
  return (
    <div className={styles.card}>
      <OpenRow
        label={t('young.explain')}
        value={explainPerDay === 0 ? t('young.explainNone') : t('young.perDayCount', { count: explainPerDay })}
        icon={Lightbulb}
        action={t('common.change')}
        onOpen={() => onOpen('explain')}
      />
    </div>
  )
}

// Its week: the time read and the articles opened.
export const WeekRows = ({ loaded, onOpen }: Omit<RowsProps, 'profile'>) => {
  const { t } = useTranslation()
  const weekMinutes = Math.round(loaded.week.days.reduce((sum, day) => sum + day.seconds, 0) / 60)
  return (
    <div className={styles.card}>
      <OpenRow
        label={t('young.week')}
        value={
          weekMinutes === 0 && loaded.week.articles === 0
            ? t('young.weekNone')
            : t('young.weekHint', {
                time: formatMinutes(weekMinutes),
                articles: t('count.article', { count: loaded.week.articles })
              })
        }
        icon={ChartColumn}
        action={t('young.see')}
        onOpen={() => onOpen('week')}
      />
    </div>
  )
}
