import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import type { Profile, ProfileKind, YouthLimits } from '../../../../api.ts'
import { editProfile } from '../../../../lib/profiles.ts'
import { showSaved } from '../../../../lib/toast.ts'
import { settingsHref } from '../../../../lib/use-hash-route.ts'
import RichText from '../../../../ui/RichText.tsx'
import ProfileForm from '../../../profiles/ProfileForm.tsx'
import { DailyDialog, ExplainDialog, RangeDialog } from './RulesDialogs.tsx'
import SourcesDialog from './SourcesDialog.tsx'
import TopicsDialog from './TopicsDialog.tsx'
import WeekDialog from './WeekDialog.tsx'
import type { Loaded, Opened } from './young-load.ts'

export interface YoungDialog {
  title: string
  intro: ReactNode
  body: ReactNode
  size?: 'compact' | 'wide'
}

export interface DialogsInput {
  t: TFunction
  id: number
  profile: Profile
  loaded: Loaded
  setLoaded: (update: (previous: Loaded | null) => Loaded | null) => void
  admin: boolean
  close: () => void
  remove: () => void
}

// Changing the profile itself, its sources and its themes.
const readingDialogs = ({ t, id, profile, loaded, setLoaded, admin, close, remove }: DialogsInput) => {
  const kinds: ProfileKind[] = admin ? ['adult', 'teen', 'child'] : ['teen', 'child']
  return {
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
      size: 'wide' as const,
      body: (
        <SourcesDialog
          profileId={id}
          name={profile.name}
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
    }
  }
}

// Its time and hours, its AI explanations, and its week.
const rulesDialogs = ({ t, id, profile, loaded, setLoaded, close }: DialogsInput) => {
  const { rules } = loaded.limits
  const saveLimits = (limits: YouthLimits) => {
    setLoaded(previous => previous && { ...previous, limits })
    close()
  }
  const labels = new Map(loaded.topics.map(topic => [topic.id, topic.label]))
  return {
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
      intro: <RichText i18nKey="dialogIntro.explain" values={{ name: profile.name }} />,
      body: <ExplainDialog profileId={id} rules={rules} onCancel={close} onSaved={saveLimits} />
    },
    week: {
      title: t('young.weekTitle'),
      intro: <RichText i18nKey="dialogIntro.week" />,
      size: 'wide' as const,
      body: <WeekDialog week={loaded.week} labels={labels} color={profile.color} />
    }
  }
}

// Every change on the page happens in one of these dialogs.
export const dialogsOf = (input: DialogsInput): Record<Opened, YoungDialog> => ({
  ...readingDialogs(input),
  ...rulesDialogs(input)
})
