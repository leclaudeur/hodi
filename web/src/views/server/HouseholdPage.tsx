import { Eye, RotateCcw, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  type ServerAccount,
  type ServerHousehold,
  createHouseholdAdminCode,
  createHouseholdCode,
  deleteServerHousehold
} from '../../api.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { contentDays } from '../../lib/content-days.ts'
import { serverHref } from '../../lib/use-hash-route.ts'
import Chip from '../../ui/Chip.tsx'
import MoreRow from '../../ui/MoreRow.tsx'
import RichText from '../../ui/RichText.tsx'
import CodeDialog from '../profiles/CodeDialog.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import { dateOf, usePeople } from './server-people.ts'

// How many rows a list shows before « Voir les N autres ».
const FOLDED = 3

// The household's accounts, folded after a few.
const AccountRows = ({
  accounts,
  shown,
  onMore
}: {
  accounts: ServerAccount[]
  shown: ServerAccount[]
  onMore: () => void
}) => {
  const { t } = useTranslation()
  const hidden = accounts.length - shown.length
  return (
    <ul className={styles.card}>
      {accounts.length === 0 && (
        <SettingRow as="li" className={styles.quietRow} label={t('server.people.household.noAccounts')} />
      )}
      {shown.map(account => (
        <SettingRow
          key={account.id}
          as="li"
          label={account.email}
          value={t(`server.people.account.roles.${account.profile?.role ?? 'none'}`)}
          action={{
            label: t('server.people.household.see'),
            ariaLabel: t('server.people.household.seeLabel', { email: account.email }),
            icon: Eye,
            href: `${serverHref('accounts')}/${account.id}`
          }}
        />
      ))}
      {hidden > 0 && (
        <li>
          <MoreRow label={t('server.people.household.more', { count: hidden })} onClick={onMore} />
        </li>
      )}
    </ul>
  )
}

// Its admin, or, for a household made for someone else whose code is still unused, that person and a new code.
const AdminRow = ({
  household,
  accounts,
  onRemake
}: {
  household: ServerHousehold
  accounts: number
  onRemake: () => void
}) => {
  const { t } = useTranslation()
  const name = household.admin
  if (!name || accounts > 0) return <SettingRow label={t('server.people.household.admin')} value={name ?? '—'} />
  return (
    <SettingRow
      label={t('server.people.household.admin')}
      value={t('server.people.household.waiting', { name })}
      action={{
        label: t('server.people.household.adminCode'),
        ariaLabel: t('server.people.household.adminCodeLabel', { name }),
        icon: RotateCcw,
        onClick: onRemake
      }}
    />
  )
}

const confirmDelete = (household: ServerHousehold, count: number, accounts: number, t: TFunction) =>
  askToConfirm({
    title: t('server.people.household.confirmDelete.title', { name: household.name }),
    message: (
      <RichText
        i18nKey="server.people.household.confirmDelete.message"
        values={{
          name: household.name,
          count,
          accounts,
          days: t('count.day', { count: contentDays().backupCopies })
        }}
      />
    ),
    label: t('server.people.household.deleteButton'),
    proof: {},
    onConfirm: async proof => {
      await deleteServerHousehold(household.id, proof)
      window.location.replace(serverHref('households'))
      window.location.reload()
    }
  })

// One household, as the server's admin sees it: who runs it, how many, a way to invite someone in, and its accounts.
const HouseholdPage = ({ id, layout }: { id: string; layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const { people: loaded } = usePeople()
  const [inviting, setInviting] = useState(false)
  const [remaking, setRemaking] = useState(false)
  const [unfolded, setUnfolded] = useState(false)
  const household = loaded?.households.find(entry => String(entry.id) === id)
  if (!loaded || !household) return null

  const count = household.adults + household.young
  const full = count >= loaded.maxProfiles
  const accounts = loaded.accounts.filter(account => account.household?.id === household.id)
  const shown = unfolded ? accounts : accounts.slice(0, FOLDED)

  return (
    <SectionPage
      title={household.name}
      intro={t('server.people.household.intro', { date: dateOf(household.createdAt) })}
      layout={layout}
    >
      <h2 className={styles.label}>{t('server.people.household.this')}</h2>
      <div className={styles.card}>
        <AdminRow household={household} accounts={accounts.length} onRemake={() => setRemaking(true)} />
        <SettingRow
          label={t('server.people.household.profiles')}
          value={`${t('server.people.household.profilesValue', { count, max: loaded.maxProfiles })} · ${t(
            'server.people.household.adults',
            { count: household.adults }
          )}, ${t('server.people.household.young', { count: household.young })}`}
        />
      </div>

      <h2 className={styles.label}>{t('server.people.household.invite')}</h2>
      <div className={styles.card}>
        {/* Full: as many profiles as a household may have. */}
        {full ? (
          <SettingRow label={t('server.people.household.inviteLabel')} hint={t('server.people.household.fullHint')}>
            <Chip size="row">{t('server.people.household.full')}</Chip>
          </SettingRow>
        ) : (
          <SettingRow
            label={t('server.people.household.inviteLabel')}
            hint={t('server.people.household.inviteHint')}
            action={{
              label: t('server.people.household.invite'),
              icon: UserPlus,
              onClick: () => setInviting(true)
            }}
          />
        )}
      </div>

      <h2 className={styles.label}>{t('server.people.household.accounts')}</h2>
      <AccountRows accounts={accounts} shown={shown} onMore={() => setUnfolded(true)} />

      <h2 className={styles.label}>{t('server.people.household.deleteSection')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('server.people.household.delete')}
          hint={t('server.people.household.deleteHint')}
          action={{
            label: t('server.people.household.deleteButton'),
            look: 'danger',
            icon: Trash2,
            onClick: () => confirmDelete(household, count, accounts.length, t)
          }}
        />
      </div>

      {remaking && (
        <CodeDialog
          target={{ id: 0, name: household.admin ?? '' }}
          onClose={() => setRemaking(false)}
          make={() => createHouseholdAdminCode(household.id)}
        />
      )}
      <CodeDialog
        target={inviting ? null : undefined}
        onClose={() => setInviting(false)}
        make={() => createHouseholdCode(household.id)}
      />
    </SectionPage>
  )
}

export default HouseholdPage
