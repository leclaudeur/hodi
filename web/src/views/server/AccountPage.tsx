import { KeyRound, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { type ServerAccount, createAccountCode, deleteServerAccount } from '../../api.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { contentDays } from '../../lib/content-days.ts'
import { clockTime } from '../../lib/format.ts'
import { serverHref } from '../../lib/use-hash-route.ts'
import RichText from '../../ui/RichText.tsx'
import CodeDialog from '../profiles/CodeDialog.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import { dateOf, usePeople } from './server-people.ts'

// What the account is: its e-mail, household, role, last visit, devices and age.
const AccountFacts = ({ account, role }: { account: ServerAccount; role: string }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.card}>
      <SettingRow label={t('server.people.account.email')} value={account.email} />
      <SettingRow
        label={t('server.people.account.household')}
        value={account.household?.name ?? t('server.people.noHousehold')}
      />
      <SettingRow
        label={t('server.people.account.role')}
        value={account.serverAdmin ? `${role} · ${t('server.people.account.serverAdmin')}` : role}
      />
      <SettingRow
        label={t('server.people.account.lastSeen')}
        value={
          account.lastSeenAt === null
            ? t('server.people.account.never')
            : t('server.people.account.lastSeenValue', {
                date: dateOf(account.lastSeenAt),
                time: clockTime(account.lastSeenAt)
              })
        }
      />
      <SettingRow label={t('server.people.account.devices')} value={String(account.devices)} />
      <SettingRow label={t('server.people.account.created')} value={dateOf(account.createdAt)} />
    </div>
  )
}

const confirmDelete = (account: ServerAccount, t: TFunction) =>
  askToConfirm({
    title: t('server.people.account.confirmDelete.title'),
    message: (
      <RichText
        i18nKey={
          account.profile?.role === 'admin'
            ? 'server.people.account.confirmDelete.messageAdmin'
            : 'server.people.account.confirmDelete.message'
        }
        values={{
          email: account.email,
          household: account.household?.name ?? '',
          days: t('count.day', { count: contentDays().backupCopies })
        }}
      />
    ),
    label: t('server.people.account.deleteButton'),
    proof: {},
    onConfirm: async proof => {
      await deleteServerAccount(account.id, proof)
      window.location.replace(serverHref('accounts'))
      window.location.reload()
    }
  })

// One account: what it is, and the one thing the server's admin does for it, a code for a new password.
const AccountPage = ({ id, layout }: { id: string; layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const { people: loaded } = usePeople()
  // The code made once the server admin's password was right, shown in its dialog.
  const [made, setMade] = useState<{ code: string; expiresAt: number } | null>(null)
  const account = loaded?.accounts.find(entry => String(entry.id) === id)
  if (!account) return null

  // The code opens that person's account: the server admin's own password comes first.
  const reset = (name: string) =>
    askToConfirm({
      title: t('confirm.resetPassword.title', { name }),
      message: <RichText i18nKey="confirm.resetPassword.message" values={{ name }} />,
      label: t('confirm.resetPassword.button'),
      proof: {},
      onConfirm: async proof => setMade(await createAccountCode(account.id, proof))
    })

  const role = t(`server.people.account.roles.${account.profile?.role ?? 'none'}`)
  return (
    <SectionPage
      title={account.profile?.name ?? account.email}
      intro={t('server.people.account.intro')}
      layout={layout}
    >
      <h2 className={styles.label}>{t('server.people.account.section')}</h2>
      <AccountFacts account={account} role={role} />

      {account.profile && (
        <>
          <h2 className={styles.label}>{t('server.people.account.reset')}</h2>
          <div className={styles.card}>
            {account.serverAdmin ? (
              <SettingRow label={t('server.people.account.resetLabel')} hint={t('server.people.account.own')} />
            ) : (
              <SettingRow
                label={t('server.people.account.resetLabel')}
                hint={t('server.people.account.resetHint')}
                action={{
                  label: t('server.people.account.resetLabel'),
                  icon: KeyRound,
                  onClick: () => reset(account.profile!.name)
                }}
              />
            )}
          </div>
          <CodeDialog
            target={made ? { id: account.profile.id, name: account.profile.name, reset: true } : undefined}
            onClose={() => setMade(null)}
            make={made ? () => Promise.resolve(made) : undefined}
          />
        </>
      )}

      {/* The server's own admin deletes theirs from Compte et données, as everyone. */}
      {!account.serverAdmin && (
        <>
          <h2 className={styles.label}>{t('server.people.account.deleteSection')}</h2>
          <div className={styles.card}>
            <SettingRow
              label={t('server.people.account.delete')}
              hint={t('server.people.account.deleteHint')}
              action={{
                label: t('server.people.account.deleteButton'),
                look: 'danger',
                icon: Trash2,
                onClick: () => confirmDelete(account, t)
              }}
            />
          </div>
        </>
      )}
    </SectionPage>
  )
}

export default AccountPage
