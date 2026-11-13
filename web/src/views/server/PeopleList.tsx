import { AlertCircle, ChevronRight, Home, Search, SearchX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ServerAccount, ServerHousehold } from '../../api.ts'
import { SERVER_HREF, serverHref } from '../../lib/use-hash-route.ts'
import { useIsDesktop } from '../../lib/use-media.ts'
import EmptyState from '../../ui/EmptyState.tsx'
import Notice from '../../ui/Notice.tsx'
import TextField from '../../ui/TextField.tsx'
import ListColumn from '../ListColumn.tsx'
import toolStyles from '../ListTools.module.css'
import MobilePage from '../MobilePage.tsx'
import navStyles from '../settings/SettingsNav.module.css'
import NoHousehold from './NoHousehold.tsx'
import serverStyles from './Server.module.css'
import { type People, type PeopleKind, usePeople } from './server-people.ts'

interface ListRow {
  id: string
  mark: string
  // A household's or an account's photo, in the initial's place.
  photo?: string | null
  name: string
  hint: string
  // What the search looks in.
  search: string
}

// The rows of Réglages' list, as they are: the initial, the name, one line under it; the chevron on a phone; a line
// between rows on a computer, as between articles.
const Rows = ({ kind, rows, active }: { kind: PeopleKind; rows: ListRow[]; active?: string }) => {
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
                  href={`${serverHref(kind)}/${row.id}`}
                  aria-current={row.id === active ? 'page' : undefined}
                >
                  <span className={`${navStyles.icon} ${serverStyles.mark}`} aria-hidden="true">
                    {row.photo ? <img className={serverStyles.markPhoto} src={row.photo} alt="" /> : row.mark}
                  </span>
                  <span className={navStyles.text}>
                    <span className={navStyles.label}>{row.name}</span>
                    <span className={navStyles.hint}>{row.hint}</span>
                  </span>
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

// No account in it yet: made for someone else, whose admin has not used the code.
const householdHint = (household: ServerHousehold, count: number, maxProfiles: number, t: TFunction) => {
  if (household.accounts === 0 && household.admin) {
    return t('server.people.householdRowWaiting', { count, name: household.admin })
  }
  if (count >= maxProfiles) return t('server.people.householdRowFull', { count })
  return t('server.people.householdRow', { count })
}

const householdRow = (household: ServerHousehold, maxProfiles: number, t: TFunction): ListRow => {
  const count = household.adults + household.young
  return {
    id: String(household.id),
    mark: household.name.charAt(0).toUpperCase(),
    photo:
      household.photoVersion === null
        ? null
        : `/api/server/households/${household.id}/photo?v=${household.photoVersion}`,
    name: household.name,
    hint: householdHint(household, count, maxProfiles, t),
    search: `${household.name} ${household.admin ?? ''}`
  }
}

const accountRow = (account: ServerAccount, t: TFunction): ListRow => ({
  id: String(account.id),
  mark: (account.profile?.name ?? account.email).charAt(0).toUpperCase(),
  photo:
    !account.profile || account.profile.photoVersion === null
      ? null
      : `/api/server/accounts/photos/${account.profile.id}?v=${account.profile.photoVersion}`,
  name: account.email,
  hint: account.household?.name ?? t('server.people.noHousehold'),
  search: `${account.email} ${account.profile?.name ?? ''} ${account.household?.name ?? ''}`
})

const rowsOf = (kind: PeopleKind, loaded: People | null, t: TFunction): ListRow[] => {
  if (!loaded) return []
  if (kind === 'households') return loaded.households.map(household => householdRow(household, loaded.maxProfiles, t))
  return loaded.accounts.map(account => accountRow(account, t))
}

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

// The server has its household and the admin cannot make another: why there is no « Créer ».
const OneNotice = () => {
  const { t } = useTranslation()
  return (
    <div className={serverStyles.oneNote}>
      <Notice icon={Home} title={t('server.people.oneTitle')}>
        {t('server.people.oneText')}
      </Notice>
    </div>
  )
}

// What the list shows in place of its rows, if anything.
interface ListState {
  failed: boolean
  none: boolean
  empty: boolean
  kind: PeopleKind
  query: string
}

const listOf = ({ failed, none, empty, kind, query }: ListState, t: TFunction) => {
  // As every list of the app that cannot load: an empty state in red, at the column's middle.
  if (failed)
    return (
      <EmptyState tone="danger" icon={<AlertCircle size={28} />} title={t('server.people.failed')}>
        {t('common.serverDown')}
      </EmptyState>
    )
  if (none) return <NoHousehold />
  if (empty)
    return (
      <EmptyState icon={<SearchX size={28} />} title={t('lists.nothingFor', { query: query.trim() })}>
        {t(kind === 'households' ? 'server.people.noMatchHouseholds' : 'server.people.noMatchAccounts')}
      </EmptyState>
    )
  return null
}

// Foyers or Comptes: the app's list column on a computer, its list page on a phone, with its search on top as
// Enregistrés and Historique have theirs.
const PeopleList = ({ kind, active }: { kind: PeopleKind; active?: string }) => {
  const { t } = useTranslation()
  const phone = !useIsDesktop()
  const { people: loaded, failed: loadFailed } = usePeople()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const all = rowsOf(kind, loaded, t)
  const rows = needle ? all.filter(row => row.search.toLowerCase().includes(needle)) : all

  const title = t(`server.titles.${kind}`)
  const label = t(kind === 'households' ? 'server.people.searchHouseholds' : 'server.people.searchAccounts')
  const meta = loaded
    ? t(kind === 'households' ? 'server.people.householdsMeta' : 'server.people.accountsMeta', {
        count: all.length
      }).toUpperCase()
    : undefined
  const search = <PeopleSearch phone={phone} label={label} query={query} onQuery={setQuery} />
  // No household yet: nothing to search.
  const none = kind === 'households' && loaded?.canCreate === true && all.length === 0
  // As every list of the app that cannot load: an empty state in red, at the column's middle.
  const one = kind === 'households' && loaded !== null && loaded.households.length > 0 && loaded.canCreate !== true
  const list = listOf(
    { failed: loadFailed, none, empty: loaded !== null && rows.length === 0 && needle !== '', kind, query },
    t
  ) ?? (
    <>
      {one && <OneNotice />}
      <Rows kind={kind} rows={rows} active={active} />
    </>
  )

  return phone ? (
    <MobilePage title={title} meta={meta} backHref={SERVER_HREF} backLabel={t('server.backToServer')}>
      {loaded && !none && search}
      <div className={serverStyles.phoneRows}>{list}</div>
    </MobilePage>
  ) : (
    <ListColumn
      title={title}
      meta={meta}

      pinned={!loaded || none ? undefined : search}
      busy={!loaded && !loadFailed}
    >
      {list}
    </ListColumn>
  )
}

export default PeopleList
