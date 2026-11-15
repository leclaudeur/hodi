import { Download, History, Pencil, Save } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ServerBackups as Backups, backupNow, getServerBackups, setBackupCopies } from '../../api.ts'
import { contentDays, setContentDays } from '../../lib/content-days.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import Stepper from '../../ui/Stepper.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import { sizeLabel } from '../settings/sections/ServerData.tsx'
import RestartScreen from '../settings/sections/plugins/RestartScreen.tsx'
import youngStyles from '../settings/sections/young/Young.module.css'
import MoreRow from '../../ui/MoreRow.tsx'
import BackupPasswordDialog, { type Copy } from './BackupPasswordDialog.tsx'
import { whenOf } from './backup-time.ts'

// How many copies show before « Voir les N autres ».
const FOLDED = 3

// « Copies gardées »: from 1 to 30, the oldest going when a new one comes.
const KeptDialog = ({
  backups,
  onClose,
  onSaved
}: {
  backups: Backups
  onClose: () => void
  onSaved: (backups: Backups) => void
}) => {
  const { t } = useTranslation()
  const [kept, setKept] = useState(backups.kept)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      onSaved(await setBackupCopies(kept))
      showSaved(t('server.backups.saved'))
      onClose()
    } catch {
      showError(t('server.backups.saveFailed'))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('server.backups.kept')}
      intro={`${t('server.backups.keptIntro')} ${t('server.backups.keptBounds', backups.bounds)}`}
    >
      <form className={youngStyles.form} onSubmit={event => void submit(event)}>
        <Stepper
          label={t('server.backups.kept')}
          lessLabel={t('server.backups.less')}
          moreLabel={t('server.backups.more2')}
          value={kept}
          min={backups.bounds.min}
          max={backups.bounds.max}
          step={1}
          onChange={setKept}
        >
          {t('server.backups.keptValue', { count: kept })}
        </Stepper>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" look="primary" busy={saving} disabled={kept === backups.kept}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// The copies, newest first and folded after a few, each to download or put back.
const CopyRows = ({
  copies,
  shown,
  onAsk,
  onMore
}: {
  copies: Copy[]
  shown: Copy[]
  onAsk: (asking: { copy: Copy; mode: 'download' | 'restore' }) => void
  onMore: () => void
}) => {
  const { t } = useTranslation()
  return (
    <ul className={styles.card}>
      {shown.map(copy => {
        const when = whenOf(copy.at)
        return (
          <SettingRow
            key={copy.name}
            as="li"
            label={t('server.backups.when', when)}
            value={<span className={styles.figure}>{sizeLabel(copy.bytes)}</span>}
            action={[
              {
                label: t('server.backups.download'),
                ariaLabel: t('server.backups.downloadLabel', when),
                icon: Download,
                onClick: () => onAsk({ copy, mode: 'download' })
              },
              {
                label: t('server.backups.restore'),
                ariaLabel: t('server.backups.restoreLabel', when),
                icon: History,
                look: 'danger',
                onClick: () => onAsk({ copy, mode: 'restore' })
              }
            ]}
          />
        )
      })}
      {copies.length > shown.length && (
        <li>
          <MoreRow label={t('server.backups.more', { count: copies.length - shown.length })} onClick={onMore} />
        </li>
      )}
    </ul>
  )
}

// The copies as the server lists them, and one made at once.
const useBackups = () => {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<Backups | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getServerBackups()
      .then(setBackups)
      .catch(() => setFailed(true))
  }, [])

  const update = (next: Backups) => {
    setBackups(next)
    // The deletion of an account says how long the copies remember it.
    setContentDays({ ...contentDays(), backupCopies: next.kept })
  }

  const saveNow = async () => {
    setSaving(true)
    try {
      update(await backupNow())
      showSaved(t('server.backups.done'))
    } catch {
      showError(t('server.backups.failed'))
    }
    setSaving(false)
  }
  return { backups, failed, saving, update, saveNow }
}

// Serveur › Sauvegardes: the nightly copies of the whole database, how many stay, one made at once, and each to
// download.
const ServerBackups = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const { backups, failed, saving, update, saveNow } = useBackups()
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState<{ copy: Copy; mode: 'download' | 'restore' } | null>(null)
  // Put back: Hodi restarts on the copy, the page waits for it then reloads.
  const [restarting, setRestarting] = useState<{ copy: Copy; change: Promise<string | null> } | null>(null)
  const restartFailed = useCallback(() => {
    setRestarting(null)
    showError(t('server.backups.restoreFailed'))
  }, [t])
  const [unfolded, setUnfolded] = useState(false)

  const copies = backups?.copies ?? []
  const shown = unfolded ? copies : copies.slice(0, FOLDED)
  const total = copies.reduce((sum, copy) => sum + copy.bytes, 0)

  return (
    <SectionPage title={t('server.titles.backups')} intro={t('server.backups.intro')} layout={layout}>
      {failed && <StatusLine tone="error">{t('server.backups.loadFailed')}</StatusLine>}
      {backups && (
        <>
          <h2 className={styles.label}>{t('server.backups.settings')}</h2>
          <div className={styles.card}>
            <SettingRow
              label={t('server.backups.kept')}
              value={t('server.backups.keptValue', { count: backups.kept })}
              action={{ label: t('common.change'), icon: Pencil, onClick: () => setEditing(true) }}
            />
            <SettingRow
              label={t('server.backups.now')}
              hint={t('server.backups.nowHint')}
              action={{ label: t('server.backups.nowButton'), icon: Save, busy: saving, onClick: () => void saveNow() }}
            />
          </div>

          <h2 className={styles.label}>
            {copies.length
              ? t('server.backups.list', { count: copies.length, size: sizeLabel(total) })
              : t('server.backups.empty')}
          </h2>
          {copies.length > 0 && (
            <CopyRows copies={copies} shown={shown} onAsk={setAsking} onMore={() => setUnfolded(true)} />
          )}

          {editing && <KeptDialog backups={backups} onClose={() => setEditing(false)} onSaved={update} />}
          {asking && (
            <BackupPasswordDialog
              copy={asking.copy}
              mode={asking.mode}
              onClose={() => setAsking(null)}
              onRestore={before => {
                setRestarting({ copy: asking.copy, change: Promise.resolve(before) })
                setAsking(null)
              }}
            />
          )}
          {restarting && (
            <RestartScreen
              change={restarting.change}
              step={t('server.backups.restoring', whenOf(restarting.copy.at))}
              onFailed={restartFailed}
            />
          )}
        </>
      )}
    </SectionPage>
  )
}

export default ServerBackups
