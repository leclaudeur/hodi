import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TOPICS_CHANGED, type TopicInfo, UnauthorizedError, setSourceTopics } from '../../../api.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import RichText from '../../../ui/RichText.tsx'
import TopicField from './TopicField.tsx'

// The source whose topics are being changed, and the ones picked so far.
export interface TopicsEdit {
  id: string
  name: string
  topicIds: string[]
}

interface SourceTopicsDialogProps {
  topics: TopicInfo[]
  editing: TopicsEdit | null
  onEditing: (editing: TopicsEdit | null) => void
  onUnauthorized: () => void
}

// Changing a source's topics happens in a dialog, as every action in Réglages.
const SourceTopicsDialog = ({ topics, editing, onEditing, onUnauthorized }: SourceTopicsDialogProps) => {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)

  const save = () => {
    if (!editing || editing.topicIds.length === 0) return
    setSaving(true)
    setSourceTopics(editing.id, editing.topicIds)
      .then(() => {
        window.dispatchEvent(new Event(TOPICS_CHANGED))
        onEditing(null)
        showSaved(t('sources.topicsSaved'))
      })
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
        else showError(t('sources.topicsFailed'))
      })
      .finally(() => setSaving(false))
  }

  return (
    <Dialog
      open={editing !== null}
      onClose={() => onEditing(null)}
      title={editing ? t('sources.topicsOf', { name: editing.name }) : ''}
      intro={editing && <RichText i18nKey="dialogIntro.sourceTopics" values={{ name: editing.name }} />}
    >
      {editing && (
        <>
          <TopicField
            topics={topics}
            selected={editing.topicIds}
            onChange={topicIds => onEditing({ ...editing, topicIds })}
            label={t('sources.topicsOf', { name: editing.name })}
          />
          <DialogActions>
            <Button onClick={() => onEditing(null)}>{t('common.cancel')}</Button>
            <Button look="primary" busy={saving} disabled={editing.topicIds.length === 0} onClick={save}>
              {t('common.save')}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}

export default SourceTopicsDialog
