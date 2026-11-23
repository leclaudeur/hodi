import { LockOpen, Mail, MailCheck, Search, ShieldCheck } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type BlockedDomain, RequestError, getBlocks, unblockDomain, unblockEmail } from '../../api.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import EmptyState from '../../ui/EmptyState.tsx'
import RichText from '../../ui/RichText.tsx'
import TextField from '../../ui/TextField.tsx'
import SectionPage from '../settings/SectionPage.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import { dateOf } from './server-people.ts'

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

// « Débloquer une adresse »: the server no longer has the address, so the admin types it, then gives their password.
const UnblockEmailDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const close = () => {
    setEmail('')
    onClose()
  }
  const ask = (event?: FormEvent) => {
    event?.preventDefault()
    if (!looksLikeEmail(email)) return
    const typed = email.trim()
    close()
    askToConfirm({
      title: t('server.blocks.emails.confirmTitle'),
      message: <RichText i18nKey="server.blocks.emails.confirmText" values={{ email: typed }} />,
      label: t('server.blocks.unblock'),
      proof: {},
      onConfirm: async proof => {
        try {
          await unblockEmail(typed, proof)
          showSaved(t('server.blocks.emails.done'))
        } catch (failure) {
          if (!(failure instanceof RequestError && failure.status === 404)) throw failure
          showError(t('server.blocks.emails.notBlocked'))
        }
      }
    })
  }
  return (
    <Dialog open={open} onClose={close} title={t('server.blocks.emails.title')} intro={t('server.blocks.emails.intro')}>
      <form onSubmit={ask}>
        <TextField
          icon={Mail}
          type="email"
          aria-label={t('server.blocks.emails.field')}
          placeholder={t('server.blocks.emails.field')}
          autoCapitalize="off"
          value={email}
          onChange={event => setEmail(event.target.value)}
          autoComplete="off"
        />
        <DialogActions>
          <Button type="button" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" look="danger" icon={MailCheck} disabled={!looksLikeEmail(email)}>
            {t('server.blocks.unblock')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// The domains blocked, with a search once there are some; each one unblocked with the admin's password.
const BlockedDomains = ({ domains, onChanged }: { domains: BlockedDomain[]; onChanged: () => void }) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  if (domains.length === 0)
    return (
      <EmptyState compact icon={<ShieldCheck size={28} />} title={t('server.blocks.sources.emptyTitle')}>
        {t('server.blocks.sources.emptyText')}
      </EmptyState>
    )
  const needle = query.trim().toLowerCase()
  const shown = needle ? domains.filter(entry => entry.domain.includes(needle)) : domains
  const unblock = ({ domain }: BlockedDomain) =>
    askToConfirm({
      title: t('server.blocks.sources.confirmTitle'),
      message: <RichText i18nKey="server.blocks.sources.confirmText" values={{ domain }} />,
      label: t('server.blocks.unblock'),
      proof: {},
      onConfirm: async proof => {
        await unblockDomain(domain, proof)
        showSaved(t('server.blocks.sources.done', { domain }))
        onChanged()
      }
    })
  return (
    <>
      <TextField
        icon={Search}
        type="search"
        aria-label={t('server.blocks.sources.search')}
        placeholder={t('server.blocks.sources.search')}
        value={query}
        onChange={event => setQuery(event.target.value)}
        onClear={() => setQuery('')}
        autoComplete="off"
      />
      <div className={styles.card}>
        {shown.map(entry => (
          <SettingRow
            key={entry.domain}
            label={entry.domain}
            hint={t('server.blocks.sources.since', { date: dateOf(entry.at) })}
            action={{
              label: t('server.blocks.unblock'),
              look: 'danger',
              icon: LockOpen,
              onClick: () => unblock(entry)
            }}
          />
        ))}
      </div>
    </>
  )
}

// Blocages: the sources blocked for illegal content, by domain, and the way back for an account blocked by mistake.
const ServerBlocks = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const [domains, setDomains] = useState<BlockedDomain[] | null>(null)
  const [unblocking, setUnblocking] = useState(false)
  // null while it loads, and if it cannot: the page says nothing wrong about the server's blocks.
  const load = () =>
    void getBlocks()
      .then(answer => setDomains(answer.domains))
      .catch(() => setDomains(null))
  useEffect(load, [])
  return (
    <SectionPage title={t('server.titles.blocks')} intro={t('server.blocks.intro')} layout={layout}>
      <h2 className={styles.label}>{t('server.blocks.sources.section')}</h2>
      {domains && <BlockedDomains domains={domains} onChanged={load} />}
      <h2 className={styles.label}>{t('server.blocks.emails.section')}</h2>
      <div className={styles.card}>
        <SettingRow
          label={t('server.blocks.emails.title')}
          hint={t('server.blocks.emails.hint')}
          action={{
            label: t('server.blocks.unblock'),
            look: 'danger',
            icon: MailCheck,
            onClick: () => setUnblocking(true)
          }}
        />
      </div>
      <UnblockEmailDialog open={unblocking} onClose={() => setUnblocking(false)} />
    </SectionPage>
  )
}

export default ServerBlocks
