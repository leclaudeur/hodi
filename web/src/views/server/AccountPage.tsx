import { Ban, KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  type ServerAccount,
  blockServerAccount,
  createAccountCode,
  deleteServerAccount,
  makeServerAdmin
} from '../../api.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { contentDays } from '../../lib/content-days.ts'
import { clockTime } from '../../lib/format.ts'
import { serverHref } from '../../lib/use-hash-route.ts'
import Notice from '../../ui/Notice.tsx'
import RichText from '../../ui/RichText.tsx'
import CodeDialog from '../profiles/CodeDialog.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import { dateOf, load, usePeople } from './server-people.ts'

// What the account is: its e-mail, role, last visit, devices and age.
const AccountFacts = ({ account, role }: { account: ServerAccount; role: string }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.card}>
      <SettingRow label={t('server.people.account.email')} value={account.email} />
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

// « Supprimer », or « Bloquer », which also keeps its e-mail from coming back: both with the admin's own password.
const confirmRemove = (account: ServerAccount, t: TFunction, blocks: boolean) =>
  askToConfirm({
    title: t(blocks ? 'server.people.account.confirmBlock.title' : 'server.people.account.confirmDelete.title'),
    message: (
      <RichText
        i18nKey={blocks ? 'server.people.account.confirmBlock.message' : 'server.people.account.confirmDelete.message'}
        values={{
          email: account.email,
          days: t('count.day', { count: contentDays().backupCopies })
        }}
      />
    ),
    label: t(blocks ? 'server.people.account.blockButton' : 'server.people.account.deleteButton'),
    proof: {},
    onConfirm: async proof => {
      await (blocks ? blockServerAccount : deleteServerAccount)(account.id, proof)
      window.location.replace(serverHref('accounts'))
      window.location.reload()
    }
  })

// « Nommer admin du serveur »: an adult runs the server too, with the admin's own password. The only way someone
// becomes it, so that the last admin can leave.
const ServerAdminRow = ({ account, name }: { account: ServerAccount; name: string }) => {
  const { t } = useTranslation()
  const confirm = () =>
    askToConfirm({
      title: t('confirm.makeServerAdmin.title', { name }),
      message: <RichText i18nKey="confirm.makeServerAdmin.message" values={{ name }} />,
      label: t('confirm.makeServerAdmin.button'),
      proof: {},
      onConfirm: async proof => {
        await makeServerAdmin(account.id, proof)
        void load()
      }
    })
  return (
    <>
      <h2 className={styles.label}>{t('server.people.account.serverAdminSection')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('server.people.account.makeServerAdmin')}
          hint={t('server.people.account.serverAdminHint')}
          action={{
            label: t('server.people.account.serverAdminButton'),
            look: 'danger',
            icon: ShieldCheck,
            onClick: confirm
          }}
        />
      </div>
    </>
  )
}

// « Mot de passe oublié » on a server without e-mail: the person waits for a code, until one is made.
const CodeAsked = ({ at, name, onMake }: { at: number; name: string; onMake: () => void }) => {
  const { t } = useTranslation()
  return (
    <Notice
      tone="warning"
      icon={KeyRound}
      title={t('server.people.account.codeAskedTitle', { date: dateOf(at), time: clockTime(at) })}
      action={{ label: t('server.people.account.resetLabel'), icon: KeyRound, onClick: onMake }}
    >
      {t('server.people.account.codeAskedText', { name })}
    </Notice>
  )
}

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
      onConfirm: async proof => {
        setMade(await createAccountCode(account.id, proof))
        // The request is handled: its notice goes.
        void load()
      }
    })

  const role = t(account.profile ? 'server.people.account.roles.member' : 'server.people.account.roles.none')
  return (
    <SectionPage
      title={account.profile?.name ?? account.email}
      intro={t('server.people.account.intro')}
      layout={layout}
    >
      {account.codeAskedAt && account.profile && (
        <CodeAsked at={account.codeAskedAt} name={account.profile.name} onMake={() => reset(account.profile!.name)} />
      )}
      <h2 className={styles.label}>{t('server.people.account.section')}</h2>
      <AccountFacts account={account} role={role} />

      {account.profile && (
        <>
          <h2 className={styles.label}>{t('server.people.account.reset')}</h2>
          <div className={styles.card}>
            {/* Only once the person asked, from the notice above: nobody takes an account over on their own. */}
            <SettingRow
              label={t('server.people.account.resetLabel')}
              hint={t(account.serverAdmin ? 'server.people.account.own' : 'server.people.account.resetOnRequest')}
            />
          </div>
          <CodeDialog
            target={made ? { id: account.profile.id, name: account.profile.name, reset: true } : undefined}
            onClose={() => setMade(null)}
            make={made ? () => Promise.resolve(made) : undefined}
          />
        </>
      )}

      {!account.serverAdmin && account.profile?.kind === 'adult' && (
        <ServerAdminRow account={account} name={account.profile.name} />
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
                onClick: () => confirmRemove(account, t, false)
              }}
            />
            <SettingRow
              label={t('server.people.account.block')}
              hint={t('server.people.account.blockHint')}
              action={{
                label: t('server.people.account.blockButton'),
                look: 'danger',
                icon: Ban,
                onClick: () => confirmRemove(account, t, true)
              }}
            />
          </div>
        </>
      )}
    </SectionPage>
  )
}

export default AccountPage
