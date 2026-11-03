import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type YouthCatalogueTopic, setYouthSources } from '../../../../api.ts'
import { showError, showSaved } from '../../../../lib/toast.ts'
import Button from '../../../../ui/Button.tsx'
import DaySeparator from '../../../../ui/DaySeparator.tsx'
import DialogActions from '../../../../ui/DialogActions.tsx'
import SourceAvatar from '../../../../ui/SourceAvatar.tsx'
import Toggle from '../../../../ui/Toggle.tsx'
import styles from './Young.module.css'

const hostOf = (site: string) => (URL.canParse(site) ? new URL(site).hostname.replace(/^www\./, '') : site)

interface SourcesDialogProps {
  profileId: number
  name: string
  topics: YouthCatalogueTopic[]
  onCancel: () => void
  onSaved: (topics: YouthCatalogueTopic[]) => void
}

// "Sources de Zoé": the young readers' catalogue for its kind, theme by theme, a switch per source. Saved together.
const SourcesDialog = ({ profileId, name, topics, onCancel, onSaved }: SourcesDialogProps) => {
  const { t } = useTranslation()
  const [on, setOn] = useState(
    () => new Set(topics.flatMap(topic => topic.sources.filter(source => source.on).map(source => source.id)))
  )
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      onSaved(await setYouthSources(profileId, [...on]))
      showSaved(t('young.saved'))
    } catch {
      showError(t('young.saveFailed'))
      setSaving(false)
    }
  }

  // The YouTube channels it was given have no theme: their group is named here.
  const labelOf = (topic: { id: string; label: string }) =>
    topic.id === 'channels' ? t('young.channels') : topic.label

  return (
    <form onSubmit={submit}>
      <div className={styles.scroll}>
        {topics
          .filter(topic => topic.sources.length > 0)
          .map(topic => (
            <section key={topic.id} aria-label={labelOf(topic)}>
              {/* As in Réglages › Sources: the theme, a line, its count. */}
              <DaySeparator
                label={labelOf(topic)}
                count={topic.sources.length}
                unit="source"
                still
                className={styles.separator}
              />
              <ul className={styles.list}>
                {topic.sources.map(source => (
                  <li key={source.id} className={styles.item}>
                    <SourceAvatar sourceId={source.id} sourceName={source.name} size={44} />
                    <span className={styles.itemText}>
                      <span className={styles.itemName}>{source.name}</span>
                      <span className={styles.itemSite}>{hostOf(source.site)}</span>
                    </span>
                    <Toggle
                      label={t('young.sourceToggle', { name: source.name, profile: name })}
                      checked={on.has(source.id)}
                      onChange={checked =>
                        setOn(previous => {
                          const next = new Set(previous)
                          if (checked) next.add(source.id)
                          else next.delete(source.id)
                          return next
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
      <DialogActions>
        <Button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" look="primary" busy={saving}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </form>
  )
}

export default SourcesDialog
