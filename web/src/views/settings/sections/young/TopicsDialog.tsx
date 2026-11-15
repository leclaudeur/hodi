import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type YouthTopic, setYouthTopics } from '../../../../api.ts'
import { showError, showSaved } from '../../../../lib/toast.ts'
import Button from '../../../../ui/Button.tsx'
import DialogActions from '../../../../ui/DialogActions.tsx'
import TopicIcon from '../../../../ui/TopicIcon.tsx'
import Toggle from '../../../../ui/Toggle.tsx'
import styles from './Young.module.css'

interface TopicsDialogProps {
  profileId: number
  topics: YouthTopic[]
  onCancel: () => void
  onSaved: (topics: YouthTopic[]) => void
}

// "Thèmes de Zoé": the themes its kind may see, each on unless its parents turn it off.
const TopicsDialog = ({ profileId, topics, onCancel, onSaved }: TopicsDialogProps) => {
  const { t } = useTranslation()
  const [hidden, setHidden] = useState(() => new Set(topics.filter(topic => !topic.on).map(topic => topic.id)))
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      onSaved(await setYouthTopics(profileId, [...hidden]))
      showSaved(t('young.saved'))
    } catch {
      showError(t('young.saveFailed'))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div className={styles.scroll}>
        <ul className={styles.list}>
          {topics.map(topic => (
            <li key={topic.id} className={styles.item}>
              <span className={styles.topicIcon} data-topic={topic.id}>
                <TopicIcon topicId={topic.id} size={18} />
              </span>
              <span className={styles.itemText}>
                <span className={styles.itemName}>{topic.label}</span>
              </span>
              <Toggle
                label={topic.label}
                checked={!hidden.has(topic.id)}
                onChange={checked =>
                  setHidden(previous => {
                    const next = new Set(previous)
                    if (checked) next.delete(topic.id)
                    else next.add(topic.id)
                    return next
                  })
                }
              />
            </li>
          ))}
        </ul>
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

export default TopicsDialog
