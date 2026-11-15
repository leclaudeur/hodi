import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { clearStoredTexts } from '../../../api.ts'
import { getLanguage, t } from '../../../lib/i18n.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { useStorage } from '../../../lib/settings-data.ts'
import { showDone, showError } from '../../../lib/toast.ts'
import RichText from '../../../ui/RichText.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

const number = (value: number) => value.toLocaleString(getLanguage())

// "27,9 Mo", "850 Ko".
export const sizeLabel = (bytes: number) =>
  bytes < 1_000_000
    ? t('settings.data.kb', { value: Math.max(1, Math.round(bytes / 1000)) })
    : t('settings.data.mb', { value: (bytes / 1_000_000).toLocaleString(getLanguage(), { maximumFractionDigits: 1 }) })

// What the household keeps on the server, and its stored texts to clear: the admin's.
const ServerData = () => {
  const { t } = useTranslation()
  const { value: storage, replace } = useStorage()
  const [clearing, setClearing] = useState(false)

  const clearTexts = async () => {
    setClearing(true)
    const before = storage?.databaseBytes ?? null
    try {
      const after = await clearStoredTexts()
      replace(after)
      const freed = before === null ? 0 : before - after.databaseBytes
      showDone(freed > 0 ? t('settings.data.clearedFreed', { size: sizeLabel(freed) }) : t('settings.data.cleared'))
    } catch {
      showError(t('settings.data.clearFailed'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <h2 className={styles.label}>{t('settings.data.server')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('settings.data.database')}
          value={
            storage
              ? `${sizeLabel(storage.databaseBytes)} · ${t('settings.data.articles', {
                  count: storage.articles,
                  total: number(storage.articles),
                  texts: number(storage.texts)
                })}`
              : '…'
          }
        />
        <SettingRow label={t('settings.data.texts')} value={t('settings.data.days', { count: 7 })} />
        <SettingRow
          label={t('settings.data.kept')}
          hint={t('settings.data.keptHint')}
          action={{
            label: t(clearing ? 'settings.data.clearing' : 'settings.data.clear'),
            look: 'danger',
            icon: Trash2,
            disabled: clearing,
            onClick: () =>
              askToConfirm({
                title: t('confirm.clearTexts.title'),
                message: <RichText i18nKey="confirm.clearTexts.message" />,
                label: t('confirm.clearTexts.button'),
                onConfirm: () => void clearTexts()
              })
          }}
        />
        <SettingRow
          label={t('settings.data.backups')}
          value={
            storage
              ? `${sizeLabel(storage.backupBytes)} · ${t('settings.data.backupsCount', { count: storage.backups })}`
              : t('settings.data.sevenKept')
          }
        />
      </div>
    </>
  )
}

export default ServerData
