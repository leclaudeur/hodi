import { Smartphone, Trash2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { askToConfirm } from '../../../lib/confirm.ts'
import { isYoung, removeProfile, useProfiles } from '../../../lib/profiles.ts'
import { usePendingRequests } from '../../../lib/requests.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import { settingsHref } from '../../../lib/use-hash-route.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import CodeDialog from '../../profiles/CodeDialog.tsx'
import YoungDevices from '../../profiles/YoungDevices.tsx'
import RichText from '../../../ui/RichText.tsx'
import SectionPage from '../SectionPage.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import { AiRows, ReadingRows, TimeRows, WeekRows, YoungHead } from './young/YoungRows.tsx'
import { dialogsOf } from './young/young-dialogs.tsx'
import { type Opened, useYoungLoad } from './young/young-load.ts'

type Layout = 'desktop' | 'phone'

// Gone, or not a young one (an address typed by hand): back to the list. Plain functions, not components: the page
// keeps the same SectionPage from loading to loaded.
const notFound = (title: string, layout: Layout, t: TFunction) => {
  return (
    <SectionPage title={title} layout={layout}>
      <StatusLine tone="info">{t('young.notFound')}</StatusLine>
      <Button href={settingsHref('profiles')}>{t('common.back')}</Button>
    </SectionPage>
  )
}

const loading = (title: string, layout: Layout, failed: boolean, t: TFunction) => {
  return (
    <SectionPage title={title} layout={layout}>
      {failed ? (
        <StatusLine tone="error">{t('young.loadFailed')}</StatusLine>
      ) : (
        <>
          <RowsSkeleton rows={1} lead="round" end="button" />
          <RowsSkeleton rows={2} lead="none" end="button" />
          <RowsSkeleton rows={3} lead="none" end="button" />
        </>
      )}
    </SectionPage>
  )
}

// Asked over its form, which goes with the profile; then back to the list.
const confirmRemove = (id: number, name: string, close: () => void, t: TFunction) =>
  askToConfirm({
    title: t('confirm.deleteProfile.title'),
    message: <RichText i18nKey="confirm.deleteProfile.message" values={{ name }} />,
    label: t('confirm.deleteProfile.button'),
    onConfirm: () => {
      close()
      void removeProfile(id)
        .then(() => {
          showSaved(t('young.deleted', { name }))
          window.location.hash = settingsHref('profiles')
        })
        .catch(() => showError(t('young.deleteFailed')))
    }
  })

// Réglages > Profils > Gérer: a young profile's page, for its parents. What it reads (sources, themes), when and how
// long (time per day, hours, quiet hours), its AI explanations, and its week. Every change happens in a dialog.
const YoungProfileSection = ({ id, layout }: { id: number; layout: Layout }) => {
  const { t } = useTranslation()
  const value = useProfiles({ fresh: true })
  const [opened, setOpened] = useState<Opened | null>(null)
  const [connecting, setConnecting] = useState(false)
  const profile = value?.profiles.find(entry => entry.id === id)
  const own = value?.profiles.find(entry => entry.id === value.current)
  const admin = own?.role === 'admin'
  const young = profile && isYoung(profile)
  // A teen asks for sources: what it asked waits here too, as on top of Réglages.
  const asked = usePendingRequests(profile?.kind === 'teen').filter(request => request.profileId === id)
  const { loaded, setLoaded, failed } = useYoungLoad(id, young)

  const title = profile?.name ?? t('young.manage')
  if (value && (!profile || !young)) return notFound(title, layout, t)
  if (!profile || !loaded) return loading(title, layout, failed, t)

  const name = profile.name
  const close = () => setOpened(null)
  const remove = () => confirmRemove(id, name, close, t)
  const dialog = opened ? dialogsOf({ t, id, profile, loaded, setLoaded, admin, close, remove })[opened] : null
  const rows = { profile, loaded, onOpen: setOpened }

  return (
    <SectionPage title={name} layout={layout}>
      <YoungHead {...rows} />

      <h2 className={styles.label}>{t('young.reading')}</h2>
      <ReadingRows {...rows} asked={asked} />

      <h2 className={styles.label}>{t('young.time')}</h2>
      <TimeRows {...rows} />

      <h2 className={styles.label}>{t('young.ai')}</h2>
      <AiRows {...rows} />

      <h2 className={styles.label}>{t('young.followUp')}</h2>
      <WeekRows {...rows} />

      {/* Its own tablet or phone, linked with a code, and those already linked. Codes come with personal accounts. */}
      {own?.hasAccount && (
        <>
          <h2 className={styles.label}>{t('young.devices')}</h2>
          <div className={styles.card}>
            <YoungDevices profile={profile} />
            <SettingRow
              label={t('young.ownDevice')}
              hint={t('young.ownDeviceHint')}
              action={{ label: t('profileForm.connect'), icon: Smartphone, onClick: () => setConnecting(true) }}
            />
          </div>
        </>
      )}

      {/* Only the admin deletes a profile. */}
      {admin && (
        <>
          <h2 className={styles.label}>{t('young.profile')}</h2>
          <div className={styles.card}>
            <SettingRow
              label={t('young.delete')}
              hint={t('young.deleteHint')}
              action={{ label: t('young.deleteButton'), look: 'danger', icon: Trash2, onClick: remove }}
            />
          </div>
        </>
      )}

      <Dialog
        open={dialog !== null}
        onClose={close}
        title={dialog?.title ?? ''}
        intro={dialog?.intro}
        size={dialog?.size}
      >
        {dialog?.body}
      </Dialog>
      {/* Remade at each opening: a new code, nothing left of the one before. */}
      <CodeDialog
        key={connecting ? 'open' : 'closed'}
        target={connecting ? { id: profile.id, name, young: true } : undefined}
        onClose={() => setConnecting(false)}
      />
    </SectionPage>
  )
}

export default YoungProfileSection
