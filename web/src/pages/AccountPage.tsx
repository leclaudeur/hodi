import { ArrowLeft, ListTree } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { AccountView } from '../api.ts'
import { useTranslation } from 'react-i18next'
import { backTo } from '../lib/came-from.ts'
import { useProfiles } from '../lib/profiles.ts'
import { type AccountPart, SETTINGS_HREF, accountHref, useHashRoute } from '../lib/use-hash-route.ts'
import { useIsPhone } from '../lib/use-media.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import Logo from '../ui/Logo.tsx'
import Menu, { MenuItem } from '../ui/Menu.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import { rich } from '../ui/rich.tsx'
import RowsSkeleton from '../views/settings/SettingsSkeleton.tsx'
import { useAccount } from '../views/settings/sections/AccountSection.tsx'
import YoungProfileSection from '../views/settings/sections/YoungProfileSection.tsx'
import { PART_ICONS, PartBody, introKeyOf, partsOf } from './account/account-parts.tsx'
import styles from './AccountPage.module.css'

export const Header = ({ back }: { back: string }) => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  return (
    <header className={styles.top}>
      <div className={styles.topIn}>
        <Logo size={28} />
        <div className={styles.topActions}>
          {phone ? (
            <RoundButton icon={ArrowLeft} label={t('common.back')} size={34} href={back} />
          ) : (
            <Button compact icon={ArrowLeft} href={back}>
              {t('common.back')}
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}

const Side = ({ parts, current }: { parts: AccountPart[]; current: AccountPart }) => {
  const { t } = useTranslation()
  return (
    <nav className={styles.side} aria-label={t('accountPage.title')}>
      <span className={styles.group}>{t('accountPage.title')}</span>
      {parts.map(part => {
        const Icon = PART_ICONS[part]
        return (
          <a key={part} href={accountHref(part)} aria-current={part === current ? 'page' : undefined}>
            <span className={styles.sq}>
              <Icon size={14} aria-hidden="true" />
            </span>
            {t(`accountPage.sections.${part}`)}
          </a>
        )
      })}
    </nav>
  )
}

// Phone and tablet: the sections in a menu, under the header, as the legal pages' tabs.
const Crumb = ({ parts, current }: { parts: AccountPart[]; current: AccountPart }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.crumb}>
      <span className={styles.group}>{t('accountPage.title')}</span>
      <span className={styles.sections}>
        <Button compact icon={ListTree} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t('accountPage.sectionsButton')}
        </Button>
        <Menu open={open} onClose={() => setOpen(false)} label={t('accountPage.sectionsButton')} align="end">
          {parts.map(part => (
            <MenuItem
              key={part}
              icon={PART_ICONS[part]}
              checked={part === current}
              onClick={() => {
                setOpen(false)
                window.location.hash = accountHref(part)
              }}
            >
              {t(`accountPage.sections.${part}`)}
            </MenuItem>
          ))}
        </Menu>
      </span>
    </div>
  )
}

const PageHead = ({ kicker, title, meta }: { kicker: string; title: string; meta?: string }) => (
  <div className={styles.head}>
    <span className={styles.kicker}>{kicker}</span>
    <h1 className={styles.title}>
      {title}
      <span className={styles.dot} aria-hidden="true" />
    </h1>
    {meta && <span className={styles.meta}>{meta}</span>}
  </div>
)

interface PartViewProps {
  part: AccountPart
  account: AccountView | null | undefined
  onAccount: (account: AccountView) => void
  meta: string
  phone: boolean
  onUnauthorized: () => void
}

// One section: its title, its intro, its body.
const PartView = ({ part, account, onAccount, meta, phone, onUnauthorized }: PartViewProps) => {
  const { t } = useTranslation()
  return (
    <>
      <PageHead kicker={t('accountPage.title')} title={t(`accountPage.sections.${part}`)} meta={meta} />
      {account === undefined ? (
        <RowsSkeleton rows={3} end="button" />
      ) : (
        <>
          <p className={styles.intro}>{rich(t(introKeyOf(part, account)))}</p>
          <PartBody
            part={part}
            account={account}
            onAccount={onAccount}
            layout={phone ? 'phone' : 'desktop'}
            onUnauthorized={onUnauthorized}
          />
        </>
      )}
    </>
  )
}

// Mon compte, as the legal pages: the app's header, the sections in a sidebar, one section at a time.
const AccountPage = () => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const route = useHashRoute()
  const onUnauthorized = useCallback(() => window.location.replace('/'), [])
  const [account, setAccount] = useAccount(onUnauthorized)
  const household = useProfiles({ onError: () => {} })
  const own = household?.profiles.find(profile => profile.id === household.current)
  const parts = account === undefined ? [] : partsOf(account)
  const asked = route.name === 'account' ? route.part : null
  const current = asked && parts.includes(asked) ? asked : (parts[0] ?? 'sign-in')
  // Mes enfants › Gérer: a young one's card, its name for title, back to the list.
  const item = route.name === 'account' ? route.item : undefined
  const youngId = current === 'children' && item && /^\d+$/.test(item) ? Number(item) : null
  const young = youngId === null ? null : household?.profiles.find(profile => profile.id === youngId)
  const meta = [own?.name, account?.email].filter(Boolean).join(' · ')
  return (
    <div className={styles.page}>
      <Header back={youngId === null ? backTo('#/account', SETTINGS_HREF) : accountHref('children')} />
      <div className={styles.frame}>
        <div className={styles.view}>
          <div className={styles.wrap}>
            <Side parts={parts} current={current} />
            <main className={styles.main}>
              <Crumb parts={parts} current={current} />
              {youngId === null ? (
                <PartView
                  part={current}
                  account={account}
                  onAccount={setAccount}
                  meta={meta}
                  phone={phone}
                  onUnauthorized={onUnauthorized}
                />
              ) : (
                <>
                  <PageHead kicker={t('accountPage.sections.children')} title={young?.name ?? t('young.manage')} />
                  <YoungProfileSection id={youngId} />
                </>
              )}
            </main>
          </div>
        </div>
        <footer className={styles.foot}>
          <Copyright />
        </footer>
      </div>
    </div>
  )
}

export default AccountPage
