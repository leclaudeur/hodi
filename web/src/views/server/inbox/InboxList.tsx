import { AlertCircle, ArrowRight, ChevronRight, Inbox, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InboxItem } from '../../../api.ts'
import { timeAgo } from '../../../lib/format.ts'
import { INBOX_KINDS, type InboxKind, inboxItemOf, inboxKindOf, isWaiting } from '../../../lib/server-inbox.ts'
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
import settingsStyles from '../../settings/Settings.module.css'
import serverStyles from '../Server.module.css'
import InboxIcon from './InboxIcon.tsx'
import styles from './Inbox.module.css'
import { useInbox } from './use-inbox.ts'

// The item in the admin's language, else the other one.
export const textsOf = (item: InboxItem, language: string) =>
  item.texts[language as 'fr' | 'en'] ?? item.texts.fr ?? item.texts.en ?? null

// Tout, then a capsule for each kind the list holds.
const KindFilters = ({ items, chosen, phone, onChoose }: KindFiltersProps) => {
  const { t } = useTranslation()
  const kinds = INBOX_KINDS.filter(kind => items.some(item => inboxKindOf(item) === kind))
  return (
    <div
      className={`${phone ? rowStyles.row : followedStyles.filters} no-scrollbar edge-fade`}
      role="group"
      aria-label={t('server.inbox.filter')}
    >
      <FilterChip selected={chosen === null} count={items.length} onClick={() => onChoose(null)}>
        {t('server.inbox.kinds.all')}
      </FilterChip>
      {kinds.map(kind => (
        <FilterChip
          key={kind}
          selected={chosen === kind}
          count={items.filter(item => inboxKindOf(item) === kind).length}
          onClick={() => onChoose(chosen === kind ? null : kind)}
        >
          {t(`server.inbox.kinds.${kind}`)}
        </FilterChip>
      ))}
    </div>
  )
}

interface KindFiltersProps {
  items: InboxItem[]
  chosen: InboxKind | null
  phone: boolean
  onChoose: (kind: InboxKind | null) => void
}

// One row per item, as Comptes' rows: its kind's square, orange while it waits, its title, who and when.
const Rows = ({ items, active, phone }: { items: InboxItem[]; active?: string; phone: boolean }) => {
  const { i18n } = useTranslation()
  return (
    <ul className={`${navStyles.entries} ${phone ? '' : serverStyles.lined}`}>
      {items.map(item => {
        const texts = textsOf(item, i18n.language)
        if (!texts) return null
        const waiting = isWaiting(item)
        const open = String(item.id) === active
        return (
          <li key={item.id}>
            <a
              className={`${navStyles.entry} ${open ? navStyles.active : ''}`}
              href={`${serverHref('inbox')}/${item.id}`}
              aria-current={open ? 'page' : undefined}
            >
              <span className={`${navStyles.icon} ${waiting ? settingsStyles.rustTile : ''}`} aria-hidden="true">
                <InboxIcon kind={inboxKindOf(item)} size={18} />
              </span>
              <span className={navStyles.text}>
                <span className={navStyles.label}>{texts.title}</span>
                <span className={navStyles.hint}>
                  {`${texts.from} · ${timeAgo(new Date(item.createdAt).toISOString())}`}
                </span>
              </span>
              {phone && <ChevronRight size={16} aria-hidden="true" className={navStyles.chevron} />}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

// À traiter, as Comptes: the app's list column on a computer, its list page on a phone, the kinds' capsules on top
// and how each kind is told at its foot.
const InboxList = ({ active }: { active?: string }) => {
  const { t } = useTranslation()
  const phone = !useIsDesktop()
  const { items, failed } = useInbox()
  const [chosen, setChosen] = useState<InboxKind | null>(null)
  const shown = (items ?? []).filter(item => chosen === null || inboxKindOf(item) === chosen)
  const waiting = (items ?? []).filter(isWaiting).length
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
  // The open one: the address's, else on a computer the first, as Comptes.
  const open = active && items ? inboxItemOf(items, active) : phone ? null : (items?.[0] ?? null)
  let list = <Rows items={shown} active={open ? String(open.id) : undefined} phone={phone} />
  if (failed)
    list = (
      <EmptyState tone="danger" icon={<AlertCircle size={28} />} title={t('server.inbox.failed')}>
        {t('common.serverDown')}
      </EmptyState>
    )
  else if (items?.length === 0)
    list = (
      <EmptyState icon={<Inbox size={28} />} title={t('server.inbox.emptyTitle')}>
        {t('server.inbox.emptyHint')}
      </EmptyState>
    )

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
