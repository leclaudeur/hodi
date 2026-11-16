import { BellOff, Mail, MailWarning } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ServerNoticeKind, type ServerNotices, chooseServerNotice, getServerNotices } from '../../api.ts'
import { notificationSupport } from '../../lib/notifications.ts'
import { type NoticeGroup, noticeGroups, noticeTexts } from '../../lib/server-notice-texts.ts'
import { disableServerPush, enableServerPush, serverPushOn, syncServerPush } from '../../lib/server-push.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import { serverHref } from '../../lib/use-hash-route.ts'
import Checkbox from '../../ui/Checkbox.tsx'
import EmptyState from '../../ui/EmptyState.tsx'
import Notice from '../../ui/Notice.tsx'
import Toggle from '../../ui/Toggle.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import own from './ServerNotifications.module.css'

type Way = 'email' | 'push'
const WAYS: Way[] = ['email', 'push']

// « Push sur cet appareil »: this device takes the push notices of the admin's account.
const DeviceRow = ({ publicKey }: { publicKey: string }) => {
  const { t } = useTranslation()
  const [on, setOn] = useState(serverPushOn)
  useEffect(() => void syncServerPush(publicKey), [publicKey])
  const change = async (next: boolean) => {
    if (!next) {
      setOn(false)
      await disableServerPush()
      return
    }
    const result = await enableServerPush(publicKey)
    if (result === 'enabled') setOn(true)
    else showError(t(`server.notifications.${result}`))
  }
  return (
    <>
      <h2 className={styles.label}>{t('server.notifications.thisDevice')}</h2>
      <div className={styles.card}>
        <SettingRow label={t('server.notifications.device')} hint={t('server.notifications.deviceHint')}>
          <Toggle label={t('server.notifications.device')} checked={on} onChange={next => void change(next)} />
        </SettingRow>
      </div>
    </>
  )
}

interface GridProps {
  group: NoticeGroup
  mail: boolean
  onChoose: (kind: ServerNoticeKind, way: Way) => void
}

// One group's kinds, a row each, with its checks under the columns' names.
const GroupGrid = ({ group, mail, onChoose }: GridProps) => {
  const { t, i18n } = useTranslation()
  return (
    <>
      <div className={own.head}>
        <h2 className={styles.label}>{group.name}</h2>
        <span className={own.columns} aria-hidden="true">
          {WAYS.map(way => (
            <span key={way}>{t(`server.notifications.${way}`)}</span>
          ))}
        </span>
      </div>
      <div className={styles.card}>
        {group.kinds.map(kind => {
          const { label, hint } = noticeTexts(kind, i18n.language)
          return (
            <SettingRow key={kind.id} label={label} hint={hint ?? undefined}>
              <span className={own.cells}>
                {WAYS.map(way => (
                  <span key={way}>
                    <Checkbox
                      checked={kind[way] && (way === 'push' || mail)}
                      disabled={way === 'email' && !mail}
                      onChange={() => onChoose(kind, way)}
                    >
                      <span className={own.hidden}>
                        {t('server.notifications.choice', { kind: label, way: t(`server.notifications.${way}`) })}
                      </span>
                    </Checkbox>
                  </span>
                ))}
              </span>
            </SettingRow>
          )
        })}
      </div>
    </>
  )
}

const MailMissing = () => {
  const { t } = useTranslation()
  return (
    <Notice
      tone="warning"
      icon={MailWarning}
      title={t('server.notifications.noMailTitle')}
      action={{ label: t('server.notifications.configure'), icon: Mail, href: serverHref('mail') }}
    >
      {t('server.notifications.noMailText')}
    </Notice>
  )
}

// Serveur › Notifications: for each kind of event, e-mail, push, both or neither.
const ServerNotifications = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t, i18n } = useTranslation()
  const [notices, setNotices] = useState<ServerNotices | null>(null)
  useEffect(() => {
    getServerNotices()
      .then(setNotices)
      .catch(() => showError(t('server.notifications.loadFailed')))
  }, [t])

  const choose = (kind: ServerNoticeKind, way: Way) => {
    if (!notices) return
    const next = { ...kind, [way]: !kind[way] }
    setNotices({ ...notices, kinds: notices.kinds.map(other => (other.id === kind.id ? next : other)) })
    chooseServerNotice(kind.id, { email: next.email, push: next.push })
      .then(() => showSaved())
      .catch(() => {
        setNotices(current => current && { ...current, kinds: current.kinds.map(o => (o.id === kind.id ? kind : o)) })
        showError(t('server.notifications.saveFailed'))
      })
  }

  const groups = notices ? noticeGroups(notices.kinds, i18n.language) : []
  return (
    <SectionPage title={t('server.notifications.title')} intro={t('server.notifications.intro')} layout={layout}>
      {notices && !notices.mail && <MailMissing />}
      {notices?.publicKey && notificationSupport() === 'supported' && <DeviceRow publicKey={notices.publicKey} />}
      {groups.map(group => (
        <GroupGrid key={group.id} group={group} mail={notices?.mail ?? false} onChoose={choose} />
      ))}
      {notices && groups.length === 0 && (
        <EmptyState icon={<BellOff size={20} />} title={t('server.notifications.emptyTitle')}>
          {t('server.notifications.emptyText')}
        </EmptyState>
      )}
    </SectionPage>
  )
}

export default ServerNotifications
