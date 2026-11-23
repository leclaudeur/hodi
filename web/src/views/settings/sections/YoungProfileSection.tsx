import { Trash2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError } from '../../../api/http.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { isYoung, removeProfile, useProfiles } from '../../../lib/profiles.ts'
import { usePendingRequests } from '../../../lib/requests.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import { accountHref } from '../../../lib/use-hash-route.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import ChildParents from '../../profiles/ChildParents.tsx'
import ChildPasswordRow from '../../profiles/ChildPasswordRow.tsx'
import YoungDevices from '../../profiles/YoungDevices.tsx'
import RichText from '../../../ui/RichText.tsx'
import RowsSkeleton from '../SettingsSkeleton.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import { ReadingRows, TimeRows, WeekRows, YoungHead } from './young/YoungRows.tsx'
import { dialogsOf } from './young/young-dialogs.tsx'
import { type Opened, useYoungLoad } from './young/young-load.ts'

const CHILDREN_HREF = accountHref('children')

// Gone, or not a young one (an address typed by hand): back to the list.
const notFound = (t: TFunction) => (
  <>
    <StatusLine tone="info">{t('young.notFound')}</StatusLine>
    <Button href={CHILDREN_HREF}>{t('common.back')}</Button>
  </>
)

const loading = (failed: boolean, t: TFunction) =>
  failed ? (
    <StatusLine tone="error">{t('young.loadFailed')}</StatusLine>
  ) : (
    <>
      <RowsSkeleton rows={1} lead="round" end="button" />
      <RowsSkeleton rows={2} lead="none" end="button" />
      <RowsSkeleton rows={3} lead="none" end="button" />
    </>
  )

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
          window.location.hash = CHILDREN_HREF
        })
        .catch((failure: unknown) => {
          const twoParents = failure instanceof RequestError && failure.code === 'two_parents'
          showError(t(twoParents ? 'young.deleteTwoParents' : 'young.deleteFailed', { name }))
        })
    }
  })

// Mon compte › Mes enfants › Gérer: a young one's card, for its parents. What it reads (sources, themes), when and how
// long (time per day, hours, quiet hours), its week, its parents, its password and devices. Every change happens in a dialog.
const YoungProfileSection = ({ id }: { id: number }) => {
  const { t } = useTranslation()
  const value = useProfiles({ fresh: true })
  const [opened, setOpened] = useState<Opened | null>(null)
  const profile = value?.profiles.find(entry => entry.id === id)
  const own = value?.profiles.find(entry => entry.id === value.current)
  const admin = own?.role === 'admin'
  const young = profile && isYoung(profile)
  // A teen asks for sources: what it asked waits here too, as on top of Réglages.
  const asked = usePendingRequests(profile?.kind === 'teen').filter(request => request.profileId === id)
  const { loaded, setLoaded, failed } = useYoungLoad(id, young)

  if (value && (!profile || !young)) return notFound(t)
  if (!profile || !loaded) return loading(failed, t)

  const name = profile.name
  const close = () => setOpened(null)
  const remove = () => confirmRemove(id, name, close, t)
  const dialog = opened ? dialogsOf({ t, id, profile, loaded, setLoaded, admin, close, remove })[opened] : null
  const rows = { profile, loaded, onOpen: setOpened }

  return (
    <>
      <YoungHead {...rows} />

      <h2 className={styles.label}>{t('young.reading')}</h2>
      <ReadingRows {...rows} asked={asked} />

      <h2 className={styles.label}>{t('young.time')}</h2>
      <TimeRows {...rows} />

      <h2 className={styles.label}>{t('young.followUp')}</h2>
      <WeekRows {...rows} />

      {own?.hasAccount && <ChildParents profileId={profile.id} />}

      {own?.hasAccount && (
        <>
          {/* The password it signs in with on its own devices, and the devices signed in. */}
          <h2 className={styles.label}>{t('young.devices')}</h2>
          <div className={styles.card}>
            <ChildPasswordRow profileId={profile.id} />
            <YoungDevices profile={profile} />
          </div>
        </>
      )}

      {/* Its parents delete it, with its account. */}
      {own?.kind === 'adult' && (
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
    </>
  )
}

export default YoungProfileSection
