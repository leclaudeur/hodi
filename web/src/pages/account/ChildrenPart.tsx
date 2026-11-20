import { SlidersHorizontal, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ChildAccount, getChildren } from '../../api.ts'
import { useProfiles } from '../../lib/profiles.ts'
import { useHousehold } from '../../lib/settings-data.ts'
import { showSaved } from '../../lib/toast.ts'
import { youngProfileHref } from '../../lib/use-hash-route.ts'
import Button from '../../ui/Button.tsx'
import EmptyState from '../../ui/EmptyState.tsx'
import ProfileAvatar from '../../ui/ProfileAvatar.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import CreateChildDialog from '../../views/profiles/CreateChildDialog.tsx'
import { RowButton } from '../../views/settings/SettingRow.tsx'
import RowsSkeleton from '../../views/settings/SettingsSkeleton.tsx'
import styles from '../../views/settings/Settings.module.css'
import ParentalCodeCard from '../../views/settings/sections/ParentalCodeCard.tsx'
import profileStyles from '../../views/settings/sections/ProfilesSection.module.css'

const useChildren = () => {
  const [children, setChildren] = useState<ChildAccount[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    getChildren()
      .then(loaded => setChildren(loaded.children))
      .catch(() => setFailed(true))
  }, [])
  return { children, setChildren, failed }
}

const ChildRow = ({ child }: { child: ChildAccount }) => {
  const { t } = useTranslation()
  const kind = t(`profileForm.kinds.${child.kind}`)
  return (
    <li className={styles.row}>
      <ProfileAvatar
        profile={{
          id: child.profileId,
          name: child.name,
          color: child.color,
          photoVersion: child.photoVersion,
          avatar: child.avatar
        }}
        size={44}
      />
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{child.name}</span>
        <span className={styles.rowHint}>{child.handle ? `@${child.handle} · ${kind}` : kind}</span>
      </span>
      <RowButton
        label={t('young.manage')}
        ariaLabel={t('young.manageLabel', { name: child.name })}
        icon={SlidersHorizontal}
        href={youngProfileHref(child.profileId)}
      />
    </li>
  )
}

// The parental code, the server admin's for now: until each parent has their own, it asks for every adult on a device.
const ParentalCode = () => {
  const { value: household, replace } = useHousehold()
  return household ? <ParentalCodeCard household={household} onSaved={replace} /> : null
}

// Mon compte › Mes enfants: the teens' and children's accounts this parent runs, a new one, and the parental code.
const ChildrenPart = () => {
  const { t } = useTranslation()
  const { children, setChildren, failed } = useChildren()
  const [creating, setCreating] = useState(false)
  const serverAdmin = useProfiles()?.serverAdmin === true
  if (failed) return <StatusLine tone="error">{t('children.loadFailed')}</StatusLine>
  if (!children) return <RowsSkeleton rows={2} lead="round" end="button" />
  return (
    <>
      {children.length === 0 ? (
        <EmptyState icon={<Users size={28} />} title={t('children.empty.title')} compact>
          {t('children.empty.text')}
        </EmptyState>
      ) : (
        <ul className={styles.card}>
          {children.map(child => (
            <ChildRow key={child.accountId} child={child} />
          ))}
        </ul>
      )}
      <div className={profileStyles.actions}>
        <Button icon={UserPlus} onClick={() => setCreating(true)}>
          {t('children.create.title')}
        </Button>
      </div>
      {serverAdmin && <ParentalCode />}
      <CreateChildDialog
        open={creating}
        taken={children.map(child => child.color)}
        onClose={() => setCreating(false)}
        onCreated={child => {
          setCreating(false)
          setChildren([...children, child])
          showSaved(t('children.create.done', { name: child.name }))
          window.location.hash = youngProfileHref(child.profileId)
        }}
      />
    </>
  )
}

export default ChildrenPart
