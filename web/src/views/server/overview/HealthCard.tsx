import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ServerBackups, type ServerMail, getServerBackups, getServerMail } from '../../../api.ts'
import { sourceState, useSourceStatuses } from '../../../lib/settings-data.ts'
import { usePlugins } from '../../../plugins/registry.ts'
import { whenOf } from '../backup-time.ts'
import styles from './OverviewCards.module.css'
import board from './Overview.module.css'

const useServerState = () => {
  const [backups, setBackups] = useState<ServerBackups | null>(null)
  const [mail, setMail] = useState<ServerMail | null | undefined>(undefined)
  useEffect(() => {
    getServerBackups()
      .then(setBackups)
      .catch(() => {})
    getServerMail()
      .then(setMail)
      .catch(() => setMail(null))
  }, [])
  return { backups, mail }
}

// What the server admin may have to act on: failing feeds, no backup, no e-mail, a plugin in error, the version.
const HealthCard = () => {
  const { t } = useTranslation()
  const { backups, mail } = useServerState()
  const { value: sources } = useSourceStatuses()
  const { plugins } = usePlugins()
  const failing = sources?.filter(source => sourceState(source) === 'error').length ?? 0
  const last = backups?.copies[0]
  const working = plugins.filter(plugin => !plugin.error).length
  const health = 'server.overview.health'
  const rows = [
    {
      key: 'sources',
      label: t('server.overview.health.sources'),
      value: !sources
        ? '…'
        : failing
          ? t(`${health}.sourcesFailing`, { count: sources.length, failing })
          : t(`${health}.sourcesOk`, { count: sources.length }),
      problem: failing > 0
    },
    {
      key: 'backup',
      label: t('server.overview.health.backup'),
      value: last ? `${whenOf(last.at).date} · ${whenOf(last.at).time}` : t(`${health}.noBackup`),
      problem: backups !== null && !last
    },
    {
      key: 'mail',
      label: t('server.overview.health.mail'),
      value: mail === undefined ? '…' : t(mail ? `${health}.mailOn` : `${health}.mailOff`)
    },
    {
      key: 'plugins',
      label: t('server.overview.health.plugins'),
      value: plugins.length ? t(`${health}.pluginsOn`, { count: working }) : t(`${health}.noPlugins`),
      problem: working < plugins.length
    },
    { key: 'version', label: t('server.overview.health.version'), value: __APP_VERSION__ }
  ]
  return (
    <section className={`${board.card} ${board.third}`} aria-labelledby="overview-health">
      <h2 id="overview-health" className={board.cardTitle}>
        {t(`${health}.title`)}
      </h2>
      <ul className={styles.health}>
        {rows.map(row => (
          <li key={row.key}>
            <span>{row.label}</span>
            <b className={row.problem ? styles.problem : undefined}>{row.value}</b>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default HealthCard
