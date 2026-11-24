import Chip from '../../ui/Chip.tsx'
import { AlertCircle, ChevronRight, Search, SearchX, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { type ServerAccount, createHouseholdCode } from '../../api.ts'
import { SERVER_HREF, serverHref } from '../../lib/use-hash-route.ts'
import { useIsDesktop } from '../../lib/use-media.ts'
import Button from '../../ui/Button.tsx'
import EmptyState from '../../ui/EmptyState.tsx'
import TextField from '../../ui/TextField.tsx'
import ListColumn from '../ListColumn.tsx'
import toolStyles from '../ListTools.module.css'
import MobilePage from '../MobilePage.tsx'
import navStyles from '../settings/SettingsNav.module.css'
import CodeDialog from '../profiles/CodeDialog.tsx'
import serverStyles from './Server.module.css'
import { type People, usePeople } from './server-people.ts'

interface ListRow {
  id: string
  mark: string
  // The account's photo, in the initial's place.
  photo?: string | null
  name: string
  hint: string
  // What the search looks in.
  search: string
  // « Code demandé »: the person waits on a code for a new password.
  flag?: string
}

// The rows of Réglages' list, as they are: the initial, the name, one line under it; the chevron on a phone; a line
// between rows on a computer, as between articles.
const Rows = ({ rows, active }: { rows: ListRow[]; active?: string }) => {
  const phone = !useIsDesktop()
  return (
    <div className={`${navStyles.nav} ${phone ? navStyles.phone : navStyles.desktop}`}>
      <div className={phone ? navStyles.groups : undefined}>
        <div className={navStyles.group}>
          <ul className={`${navStyles.entries} ${phone ? '' : serverStyles.lined}`}>
            {rows.map(row => (
              <li key={row.id}>
                <a
                  className={`${navStyles.entry} ${row.id === active ? navStyles.active : ''}`}
                  href={`${serverHref('accounts')}/${row.id}`}
                  aria-current={row.id === active ? 'page' : undefined}
                >
                  <span className={`${navStyles.icon} ${serverStyles.mark}`} aria-hidden="true">
                    {row.photo ? <img className={serverStyles.markPhoto} src={row.photo} alt="" /> : row.mark}
                  </span>
                  <span className={navStyles.text}>
                    <span className={navStyles.label}>{row.name}</span>
                    <span className={navStyles.hint}>{row.hint}</span>
                  </span>
                  {row.flag && (
                    <Chip tone="warning" size="row">
                      {row.flag}
                    </Chip>
                  )}
                  {phone && <ChevronRight size={16} aria-hidden="true" className={navStyles.chevron} />}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

const accountRow = (account: ServerAccount, t: TFunction): ListRow => ({
  id: String(account.id),
  mark: (account.profile?.name ?? account.email).charAt(0).toUpperCase(),
  photo:
    !account.profile || account.profile.photoVersion === null
      ? null
      : `/api/server/accounts/photos/${account.profile.id}?v=${account.profile.photoVersion}`,
  name: account.email,
  hint: account.profile?.name ?? t('server.people.noProfile'),
  search: `${account.email} ${account.profile?.name ?? ''}`,
  ...(account.codeAskedAt ? { flag: t('server.people.account.codeAsked') } : {})
})

const rowsOf = (loaded: People | null, t: TFunction): ListRow[] =>
  loaded ? loaded.accounts.map(account => accountRow(account, t)) : []

interface SearchProps {
  phone: boolean
  label: string
  query: string
  onQuery: (query: string) => void
}

const PeopleSearch = ({ phone, label, query, onQuery }: SearchProps) => (
  <div className={phone ? toolStyles.phone : toolStyles.desktop}>
    <div className={toolStyles.field} role="search">
      <TextField
        icon={Search}
        type="search"
        aria-label={label}
        placeholder={label}
        value={query}
        onChange={event => onQuery(event.target.value)}
        onClear={() => onQuery('')}
        enterKeyHint="search"
        autoComplete="off"
      />
    </div>
  </div>
)

// Under the accounts, full width: a code for someone to make an account on this server.
const InviteButton = ({ loaded }: { loaded: People }) => {
  const { t } = useTranslation()
  const [inviting, setInviting] = useState(false)
  // Everyone reads in the server's one space.
  const space = loaded.households[0]
  if (!space) return null
  return (
    <div className={serverStyles.invite}>
      <Button icon={UserPlus} wide onClick={() => setInviting(true)}>
        {t('profiles.code.invite')}
      </Button>
      <CodeDialog
        target={inviting ? null : undefined}
        onClose={() => setInviting(false)}
        make={() => createHouseholdCode(space.id)}
      />
    </div>
  )
}

// What the list shows in place of its rows, if anything.
interface ListState {
  failed: boolean
  empty: boolean
  query: string
}

const listOf = ({ failed, empty, query }: ListState, t: TFunction) => {
  // As every list of the app that cannot load: an empty state in red, at the column's middle.
  if (failed)
    return (
      <EmptyState tone="danger" icon={<AlertCircle size={28} />} title={t('server.people.failed')}>
        {t('common.serverDown')}
      </EmptyState>
    )
  if (empty)
    return (
      <EmptyState icon={<SearchX size={28} />} title={t('lists.nothingFor', { query: query.trim() })}>
        {t('server.people.noMatchAccounts')}
      </EmptyState>
    )
  return null
}

// Comptes: the app's list column on a computer, its list page on a phone, with its search on top as
// Enregistrés and Historique have theirs.
const PeopleList = ({ active }: { active?: string }) => {
  const { t } = useTranslation()
  const phone = !useIsDesktop()
  const { people: loaded, failed: loadFailed } = usePeople()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const all = rowsOf(loaded, t)
  const rows = needle ? all.filter(row => row.search.toLowerCase().includes(needle)) : all

  const title = t('server.titles.accounts')
  const label = t('server.people.searchAccounts')
  const meta = loaded ? t('server.people.accountsMeta', { count: all.length }).toUpperCase() : undefined
  const search = <PeopleSearch phone={phone} label={label} query={query} onQuery={setQuery} />
  // At the column's foot on a computer, as « Charger <jour> » under the articles; under the list on a phone.
  const invite = loaded && !needle && !loadFailed ? <InviteButton loaded={loaded} /> : null
  const list = listOf(
    { failed: loadFailed, empty: loaded !== null && rows.length === 0 && needle !== '', query },
    t
  ) ?? (
    <>
      <Rows rows={rows} active={active} />
      {phone && invite}
    </>
  )

  return phone ? (
    <MobilePage title={title} meta={meta} backHref={SERVER_HREF} backLabel={t('server.backToServer')}>
      {loaded && search}
      <div className={serverStyles.phoneRows}>{list}</div>
    </MobilePage>
  ) : (
    <ListColumn
      title={title}
      meta={meta}
      footer={invite ?? undefined}
      pinned={loaded ? search : undefined}
      busy={!loaded && !loadFailed}
    >
      {list}
    </ListColumn>
  )
}

export default PeopleList
