import { ArrowRight, ChartColumn, Eye, Inbox, KeyRound, Puzzle, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type InboxItem, getServerInbox } from '../../api.ts'
import { timeAgo } from '../../lib/format.ts'
import { serverHref } from '../../lib/use-hash-route.ts'
import Button from '../../ui/Button.tsx'
import EmptyCard from '../settings/EmptyCard.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow, { RowButton } from '../settings/SettingRow.tsx'
import RowsSkeleton from '../settings/SettingsSkeleton.tsx'
import styles from '../settings/Settings.module.css'
import own from './ServerInbox.module.css'

type Layout = 'desktop' | 'phone'

const TypeIcon = ({ type }: { type: string }) => {
  if (type === 'core:code-request') return <KeyRound size={20} />
  if (type === 'core:weekly-report') return <ChartColumn size={20} />
  return <Puzzle size={20} />
}

const Row = ({ item }: { item: InboxItem }) => {
  const { t, i18n } = useTranslation()
  const texts = item.texts[i18n.language as 'fr' | 'en'] ?? item.texts.fr ?? item.texts.en
  const waiting = item.important && item.handledAt === null
  if (!texts) return null
  return (
    <SettingRow
      as="li"
      lead={
        <span className={`${styles.tile} ${waiting ? styles.rustTile : ''}`} aria-hidden="true">
          <TypeIcon type={item.type} />
        </span>
      }
      label={texts.title}
      hint={`${texts.from} · ${timeAgo(new Date(item.createdAt).toISOString())}`}
    >
      {item.url.startsWith('#/server') && (
        <RowButton
          label={t('server.inbox.open')}
          ariaLabel={t('server.inbox.openName', { title: texts.title })}
          icon={Eye}
          href={item.url}
        />
      )}
    </SettingRow>
  )
}

// What the server told its admins, newest first; null while it comes.
const useInbox = () => {
  const [items, setItems] = useState<InboxItem[] | null>(null)
  useEffect(() => {
    getServerInbox()
      .then(answer => setItems(answer.items))
      .catch(() => setItems([]))
  }, [])
  return items
}

// Serveur › Notifications: the requests to handle first, in orange, then the rest; Alertes chooses how each comes.
const ServerInbox = ({ layout }: { layout: Layout }) => {
  const { t } = useTranslation()
  const items = useInbox()
  const waiting = items?.filter(item => item.important && item.handledAt === null) ?? []
  const earlier = items?.filter(item => !waiting.includes(item)) ?? []

  return (
    <SectionPage title={t('server.titles.inbox')} intro={t('server.inbox.intro')} layout={layout}>
      {items === null && <RowsSkeleton rows={3} lead="square" />}
      {items?.length === 0 && (
        <EmptyCard icon={<Inbox size={20} />} title={t('server.inbox.emptyTitle')} hint={t('server.inbox.emptyHint')} />
      )}
      {waiting.length > 0 && (
        <>
          <h2 className={styles.label}>{t('server.inbox.waiting')}</h2>
          <ul className={`${styles.card} ${own.waiting}`}>
            {waiting.map(item => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
      {earlier.length > 0 && (
        <>
          <h2 className={styles.label}>{t('server.inbox.earlier')}</h2>
          <ul className={styles.card}>
            {earlier.map(item => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
      <Button icon={SlidersHorizontal} href={serverHref('notifications')} className={own.more}>
        {t('server.inbox.choose')}
        <ArrowRight size={16} aria-hidden="true" />
      </Button>
    </SectionPage>
  )
}

export default ServerInbox
