import { EyeOff, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDayFeed } from '../../../lib/day-feed.ts'
import { updatePreferences, usePreferences } from '../../../lib/preferences.ts'
import { foldText, wordPattern } from '../../../lib/word-match.ts'
import EmptyCard from '../EmptyCard.tsx'
import SectionPage from '../SectionPage.tsx'
import SettingRow from '../SettingRow.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import styles from '../Settings.module.css'
import WordForm from './WordForm.tsx'

// Muted words: articles whose title or summary holds one leave Le fil, the topics and the stories.
// Laid out as the followed subjects, a neutral crossed eye in place of their star.
const MutedSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const { mutedWords } = preferences
  const today = useDayFeed('').days[0]

  // Today's articles that a muted word hides, with the word that hides each.
  const hidden = (today?.items ?? []).flatMap(item => {
    const text = foldText(`${item.title} ${item.summary}`)
    const by = mutedWords.find(muted => wordPattern(muted).test(text))
    return by ? [{ item, by }] : []
  })

  return (
    <SectionPage title={t('settings.nav.muted')} intro={t('settings.muted.intro')} layout={layout}>
      <WordForm
        words={mutedWords}
        onAdd={word => updatePreferences({ mutedWords: [...mutedWords, word] })}
        placeholder={t('settings.muted.placeholder')}
        label={t('settings.muted.field')}
        action={t('settings.muted.add')}
      />

      {mutedWords.length === 0 ? (
        <EmptyCard
          icon={<EyeOff size={18} />}
          title={t('settings.muted.emptyTitle')}
          hint={t('settings.muted.emptyHint')}
        />
      ) : (
        <ul className={styles.card}>
          {mutedWords.map(muted => {
            const count = hidden.filter(entry => entry.by === muted).length
            return (
              <SettingRow
                key={muted}
                as="li"
                label={muted}
                hint={t('settings.muted.hiddenToday', { count })}
                lead={
                  <span className={styles.tile}>
                    <EyeOff size={18} aria-hidden="true" />
                  </span>
                }
              >
                <RoundButton
                  icon={X}
                  size={34}
                  label={t('settings.muted.unmute', { word: muted })}
                  onClick={() => updatePreferences({ mutedWords: mutedWords.filter(other => other !== muted) })}
                />
              </SettingRow>
            )
          })}
        </ul>
      )}
    </SectionPage>
  )
}

export default MutedSection
