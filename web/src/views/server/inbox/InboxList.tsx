import { AlertCircle, ArrowRight, ChevronRight, Inbox, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InboxItem } from '../../../api.ts'
import { clockTime, numericDate, timeAgo } from '../../../lib/format.ts'
import {
  INBOX_KINDS,
  type InboxFilter,
  filterInbox,
  firstOpen,
  inboxHrefOf,
  inboxItemOf,
  inboxKindOf,
  isWaiting
} from '../../../lib/server-inbox.ts'
import { SERVER_HREF, serverHref } from '../../../lib/use-hash-route.ts'
import { useIsDesktop } from '../../../lib/use-media.ts'
import Button from '../../../ui/Button.tsx'
import EmptyState from '../../../ui/EmptyState.tsx'
import FilterChip from '../../../ui/FilterChip.tsx'
import followedStyles from '../../FollowedScreen.module.css'
import ListColumn from '../../ListColumn.tsx'
import rowStyles from '../../MobileFilterRow.module.css'
import MobilePage from '../../MobilePage.tsx'
import navStyles from '../../settings/SettingsNav.module.css'
import serverStyles from '../Server.module.css'
import InboxIcon from './InboxIcon.tsx'
import styles from './Inbox.module.css'
import { useInbox } from './use-inbox.ts'

// The item in the admin's language, else the other one.
export const textsOf = (item: InboxItem, language: string) =>
  item.texts[language as 'fr' | 'en'] ?? item.texts.fr ?? item.texts.en ?? null

// Tout, a capsule for each kind still waiting, then Traité last.
const KindFilters = ({ items, chosen, phone, onChoose }: KindFiltersProps) => {
  const { t } = useTranslation()
  const waiting = filterInbox(items, null)
  const kinds = INBOX_KINDS.filter(kind => waiting.some(item => inboxKindOf(item) === kind))
  const handled = filterInbox(items, 'handled').length
  const filters: InboxFilter[] = [null, ...kinds, ...(handled > 0 ? (['handled'] as const) : [])]
  return (
    <div
      className={`${phone ? rowStyles.row : followedStyles.filters} no-scrollbar edge-fade`}
      role="group"
      aria-label={t('server.inbox.filter')}
    >
      {filters.map(filter => (
        <FilterChip
          key={filter ?? 'all'}
          selected={chosen === filter}
          count={filterInbox(items, filter).length}
          onClick={() => onChoose(chosen === filter ? null : filter)}
        >
          {t(`server.inbox.kinds.${filter ?? 'all'}`)}
        </FilterChip>
      ))}
    </div>
  )
}

interface KindFiltersProps {
  items: InboxItem[]
  chosen: InboxFilter
  phone: boolean
  onChoose: (filter: InboxFilter) => void
}

// « 21.11.2026 · 09:41 ».
export const whenOf = (at: number) => `${numericDate(new Date(at).toISOString())} · ${clockTime(at)}`

// A request's row, as Comptes' rows: its kind's square, its title, who and when. A waiting one opens where it is done;
// a handled one only says when it was.
const Row = ({ item, open, phone }: { item: InboxItem; open: boolean; phone: boolean }) => {
  const { t, i18n } = useTranslation()
  const texts = textsOf(item, i18n.language)
  if (!texts) return null
  const waiting = isWaiting(item)
  const hint = waiting
    ? `${texts.from} · ${timeAgo(new Date(item.createdAt).toISOString())}`
    : t('server.inbox.handled', { date: whenOf(item.handledAt ?? item.createdAt) })
  const content = (
    <>
      <span className={navStyles.icon} aria-hidden="true">
        <InboxIcon kind={inboxKindOf(item)} size={18} />
      </span>
      <span className={navStyles.text}>
        <span className={navStyles.label}>{texts.title}</span>
        <span className={navStyles.hint}>{hint}</span>
      </span>
      {phone && waiting && <ChevronRight size={16} aria-hidden="true" className={navStyles.chevron} />}
    </>
  )
  return (
    <li>
      {waiting ? (
        <a
          className={`${navStyles.entry} ${open ? navStyles.active : ''}`}
          href={inboxHrefOf(item)}
          aria-current={open ? 'page' : undefined}
        >
          {content}
        </a>
      ) : (
        <span className={`${navStyles.entry} ${styles.handled}`}>{content}</span>
      )}
    </li>
  )
}

const Rows = ({ items, active, phone }: { items: InboxItem[]; active?: string; phone: boolean }) => (
  <ul className={`${navStyles.entries} ${phone ? '' : serverStyles.lined}`}>
    {items.map(item => (
      <Row key={item.id} item={item} open={String(item.id) === active} phone={phone} />
    ))}
  </ul>
)

// Nothing waits, or nothing is handled.
const Empty = ({ handled }: { handled: boolean }) => {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={<Inbox size={28} />}
      title={t(handled ? 'server.inbox.handledEmptyTitle' : 'server.inbox.emptyTitle')}
    >
      {t(handled ? 'server.inbox.handledEmptyHint' : 'server.inbox.emptyHint')}
    </EmptyState>
  )
}

// À traiter, as Comptes: the app's list column on a computer, its list page on a phone, the kinds' capsules on top
// and how each kind is told at its foot.
const InboxList = ({ active }: { active?: string }) => {
  const { t } = useTranslation()
  const phone = !useIsDesktop()
  const { items, failed } = useInbox()
  const [chosen, setChosen] = useState<InboxFilter>(null)
  const shown = filterInbox(items ?? [], chosen)
  const waiting = filterInbox(items ?? [], null).length
  const title = t('server.titles.inbox')
  const meta = items ? t('server.inbox.meta', { count: waiting }).toUpperCase() : undefined
  const filters = items && items.length > 0 && (
    <KindFilters items={items} chosen={chosen} phone={phone} onChoose={setChosen} />
  )
  const choose = (
    <Button icon={SlidersHorizontal} wide href={serverHref('notifications')}>
      {t('server.inbox.choose')}
      <ArrowRight size={16} aria-hidden="true" />
    </Button>
  )
  const open = active && items ? inboxItemOf(items, active) : phone ? null : firstOpen(items ?? [])
  let list = <Rows items={shown} active={open ? String(open.id) : undefined} phone={phone} />
  if (failed)
    list = (
      <EmptyState tone="danger" icon={<AlertCircle size={28} />} title={t('server.inbox.failed')}>
        {t('common.serverDown')}
      </EmptyState>
    )
  else if (items && shown.length === 0) list = <Empty handled={chosen === 'handled'} />

  return phone ? (
    <MobilePage title={title} meta={meta} backHref={SERVER_HREF} backLabel={t('server.backToServer')}>
      {filters}
      <div className={serverStyles.phoneRows}>{list}</div>
      <div className={styles.choose}>{choose}</div>
    </MobilePage>
  ) : (
    <ListColumn
      title={title}
      meta={meta}
      pinned={filters || undefined}
      footer={<div className={styles.choose}>{choose}</div>}
      busy={items === null}
    >
      <div className={`${navStyles.nav} ${navStyles.desktop}`}>{list}</div>
    </ListColumn>
  )
}

export default InboxList
