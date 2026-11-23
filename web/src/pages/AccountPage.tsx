import { ArrowLeft, ListTree, LogOut } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProfiles } from '../lib/profiles.ts'
import { type AccountPart, accountHref, useHashRoute } from '../lib/use-hash-route.ts'
import { useIsPhone } from '../lib/use-media.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import Logo from '../ui/Logo.tsx'
import Menu, { MenuItem } from '../ui/Menu.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import { rich } from '../ui/rich.tsx'
import RowsSkeleton from '../views/settings/SettingsSkeleton.tsx'
import { useAccount } from '../views/settings/sections/AccountSection.tsx'
import { PART_ICONS, PartBody, introKeyOf, partsOf } from './account/account-parts.tsx'
import { signOutHere } from './NoHouseholdPage.tsx'
import styles from './AccountPage.module.css'

interface HeaderProps {
  back: string
  // Out of a household, the account can only leave from here.
  signOut?: () => void
}

const Header = ({ back, signOut }: HeaderProps) => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  return (
    <header className={styles.top}>
      <div className={styles.topIn}>
        <Logo size={28} />
        <div className={styles.topActions}>
          {phone ? (
            <>
              <RoundButton icon={ArrowLeft} label={t('common.back')} size={34} href={back} />
              {signOut && <RoundButton icon={LogOut} label={t('settings.logout')} size={34} onClick={signOut} />}
            </>
          ) : (
            <>
              <Button compact icon={ArrowLeft} href={back}>
                {t('common.back')}
              </Button>
              {signOut && (
                <Button compact icon={LogOut} onClick={signOut}>
                  {t('settings.logout')}
                </Button>
              )}
            </>
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

interface AccountPageProps {
  // In a household, from Réglages; out of one, from the card that says so.
  inHousehold: boolean
}

// Mon compte, as the legal pages: the app's header, the sections in a sidebar, one section at a time.
const AccountPage = ({ inHousehold }: AccountPageProps) => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const route = useHashRoute()
  const onUnauthorized = useCallback(() => window.location.replace('/'), [])
  const [account, setAccount] = useAccount(onUnauthorized)
  const household = useProfiles({ onError: () => {} })
  const own = household?.profiles.find(profile => profile.id === household.current)
  const parts = account === undefined ? [] : partsOf(account, inHousehold)
  const asked = route.name === 'account' ? route.part : null
  const current = asked && parts.includes(asked) ? asked : (parts[0] ?? 'sign-in')
  const meta = [inHousehold ? own?.name : null, account?.email].filter(Boolean).join(' · ')
  return (
    <div className={styles.page}>
      <Header back={inHousehold ? '#/settings' : '#/'} signOut={inHousehold ? undefined : () => void signOutHere()} />
      <div className={styles.frame}>
        <div className={styles.view}>
          <div className={styles.wrap}>
            <Side parts={parts} current={current} />
            <main className={styles.main}>
              <Crumb parts={parts} current={current} />
              <div className={styles.head}>
                <span className={styles.kicker}>{t('accountPage.title')}</span>
                <h1 className={styles.title}>
                  {t(`accountPage.sections.${current}`)}
                  <span className={styles.dot} aria-hidden="true" />
                </h1>
                {meta && <span className={styles.meta}>{meta}</span>}
              </div>
              {account === undefined ? (
                <RowsSkeleton rows={3} end="button" />
              ) : (
                <>
                  <p className={styles.intro}>{rich(t(introKeyOf(current, account, inHousehold)))}</p>
                  <PartBody
                    part={current}
                    account={account}
                    onAccount={setAccount}
                    inHousehold={inHousehold}
                    layout={phone ? 'phone' : 'desktop'}
                    onUnauthorized={onUnauthorized}
                  />
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
