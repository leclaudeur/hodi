import { Pencil } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ContentKey, type ServerContent as Content, getServerContent, setServerContent } from '../../api.ts'
import { contentDays, setContentDays } from '../../lib/content-days.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import Stepper from '../../ui/Stepper.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import Toggle from '../../ui/Toggle.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import youngStyles from '../settings/sections/young/Young.module.css'

const KEYS: ContentKey[] = ['articleDays', 'videoDays', 'textDays']

interface DurationDialogProps {
  setting: ContentKey | null
  content: Content
  onClose: () => void
  onSaved: (content: Content) => void
}

// One duration, by steps of a day within its bounds, saved for the whole server.
const DurationDialog = ({ setting, content, onClose, onSaved }: DurationDialogProps) => {
  const { t } = useTranslation()
  const [value, setValue] = useState(setting ? content.values[setting] : 0)
  const [saving, setSaving] = useState(false)
  const bounds = setting ? content.bounds[setting] : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!setting) return
    setSaving(true)
    try {
      onSaved(await setServerContent({ [setting]: value }))
      showSaved(t('server.content.saved'))
      onClose()
    } catch {
      showError(t('server.content.failed'))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={setting !== null}
      onClose={onClose}
      title={setting ? t(`server.content.${setting}.title`) : undefined}
      intro={
        setting && bounds ? `${t(`server.content.${setting}.intro`)} ${t('server.content.bounds', bounds)}` : undefined
      }
    >
      {setting && bounds && (
        <form className={youngStyles.form} onSubmit={submit}>
          <Stepper
            label={t(`server.content.${setting}.title`)}
            lessLabel={t('server.content.less')}
            moreLabel={t('server.content.more')}
            value={value}
            min={bounds.min}
            max={bounds.max}
            step={1}
            fastSteps={bounds.max > 30 ? [5, 10] : undefined}
            onChange={setValue}
          >
            {t('count.day', { count: value })}
          </Stepper>
          <DialogActions>
            <Button type="button" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" look="primary" busy={saving} disabled={value === content.values[setting]}>
              {t('common.save')}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  )
}

// Offered when the limit is turned on.
const DEFAULT_MAX_SOURCES = 200

interface MaxSourcesDialogProps {
  open: boolean
  content: Content
  onClose: () => void
  onSaved: (content: Content) => void
}

// How many sources a household may follow, or no limit: a switch, then a number by steps of 10.
const MaxSourcesDialog = ({ open, content, onClose, onSaved }: MaxSourcesDialogProps) => {
  const { t } = useTranslation()
  const { value: current, min, max } = content.maxSources
  const [on, setOn] = useState(current !== null)
  const [value, setValue] = useState(current ?? DEFAULT_MAX_SOURCES)
  const [saving, setSaving] = useState(false)
  const next = on ? value : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      onSaved(await setServerContent({ maxSources: next }))
      showSaved(t('server.content.saved'))
      onClose()
    } catch {
      showError(t('server.content.failed'))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('server.content.maxSources.title')}
      intro={t('server.content.maxSources.intro')}
    >
      <form className={youngStyles.form} onSubmit={submit}>
        <div className={youngStyles.switchRow}>
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>{t('server.content.maxSources.toggle')}</span>
            <span className={styles.rowHint}>{t('server.content.maxSources.toggleHint')}</span>
          </span>
          <Toggle label={t('server.content.maxSources.toggle')} checked={on} onChange={setOn} />
        </div>
        {on && (
          <Stepper
            label={t('server.content.maxSources.title')}
            lessLabel={t('server.content.less')}
            moreLabel={t('server.content.more')}
            value={value}
            min={min}
            max={max}
            step={10}
            fastSteps={[50, 100]}
            onChange={setValue}
          >
            {t('count.source', { count: value })}
          </Stepper>
        )}
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" look="primary" busy={saving} disabled={next === current}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// Serveur › Contenu: how long the server keeps what it fetches, and how many sources a household may follow.
const ServerContent = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const [content, setContent] = useState<Content | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<ContentKey | null>(null)
  const [limitOpen, setLimitOpen] = useState(false)

  useEffect(() => {
    getServerContent()
      .then(setContent)
      .catch(() => setFailed(true))
  }, [])

  const saved = (next: Content) => {
    setContent(next)
    // This device's pages say the new durations at once; the others at their next opening.
    setContentDays({ ...contentDays(), articleDays: next.values.articleDays, videoDays: next.values.videoDays })
  }

  return (
    <SectionPage title={t('server.titles.content')} intro={t('server.content.intro')} layout={layout}>
      {failed && <StatusLine tone="error">{t('server.content.loadFailed')}</StatusLine>}
      {content && (
        <>
          <h2 className={styles.label}>{t('server.content.durations')}</h2>
          <div className={styles.card}>
            {KEYS.map(key => (
              <SettingRow
                key={key}
                label={t(`server.content.${key}.label`)}
                value={t('count.day', { count: content.values[key] })}
                action={{ label: t('common.change'), icon: Pencil, onClick: () => setOpen(key) }}
              />
            ))}
          </div>
          <h2 className={styles.label}>{t('server.content.sources')}</h2>
          <div className={styles.card}>
            <SettingRow
              label={t('server.content.maxSources.label')}
              value={
                content.maxSources.value === null
                  ? t('server.content.maxSources.unlimited')
                  : t('count.source', { count: content.maxSources.value })
              }
              action={{ label: t('common.change'), icon: Pencil, onClick: () => setLimitOpen(true) }}
            />
          </div>
          <MaxSourcesDialog
            key={limitOpen ? 'open' : 'closed'}
            open={limitOpen}
            content={content}
            onClose={() => setLimitOpen(false)}
            onSaved={setContent}
          />
          <DurationDialog
            key={open ?? 'closed'}
            setting={open}
            content={content}
            onClose={() => setOpen(null)}
            onSaved={saved}
          />
        </>
      )}
    </SectionPage>
  )
}

export default ServerContent
