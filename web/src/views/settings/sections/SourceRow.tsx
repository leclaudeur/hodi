import { ArrowLeftRight, ExternalLink, MoreHorizontal, Tags, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceStatus } from '../../../api.ts'
import { shortAgo } from '../../../lib/format.ts'
import { sourceState } from '../../../lib/settings-data.ts'
import Chip from '../../../ui/Chip.tsx'
import Menu, { MenuItem } from '../../../ui/Menu.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import SourceAvatar from '../../../ui/SourceAvatar.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import styles from '../Settings.module.css'
import sourceStyles from './SourcesSection.module.css'
import { hostOf } from './sources-model.ts'

interface ActionsProps {
  source: SourceStatus
  replace: (() => void) | null
  retopic: (() => void) | null
  deletable: boolean
  removing: boolean
  onRemove: () => void
}

interface PhoneActionsProps extends ActionsProps {
  open: boolean
  onMore: (open: boolean) => void
}

// On a phone, a source's buttons go in a "⋯" menu.
const PhoneActions = ({ source, replace, retopic, deletable, removing, onRemove, open, onMore }: PhoneActionsProps) => {
  const { t } = useTranslation()
  const then = (action: () => void) => () => {
    onMore(false)
    action()
  }
  return (
    <span className={sourceStyles.more}>
      <RoundButton
        size={38}
        icon={MoreHorizontal}
        label={t('sources.moreFor', { name: source.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onMore(!open)}
      />
      <Menu open={open} onClose={() => onMore(false)} label={t('sources.moreFor', { name: source.name })} align="end">
        {replace && (
          <MenuItem icon={ArrowLeftRight} onClick={then(replace)}>
            {t('sources.replace')}
          </MenuItem>
        )}
        {retopic && (
          <MenuItem icon={Tags} onClick={then(retopic)}>
            {t('sources.changeTopics')}
          </MenuItem>
        )}
        <MenuItem icon={ExternalLink} href={source.site} label={t('addSource.seeSite', { name: source.name })}>
          {t('sources.seeSite')}
        </MenuItem>
        {deletable && (
          <MenuItem icon={Trash2} tone="danger" disabled={removing} onClick={then(onRemove)}>
            {t('sources.delete')}
          </MenuItem>
        )}
      </Menu>
    </span>
  )
}

const DesktopActions = ({ source, replace, retopic, deletable, removing, onRemove }: ActionsProps) => {
  const { t } = useTranslation()
  return (
    <>
      {replace && (
        <RoundButton
          size={38}
          icon={ArrowLeftRight}
          label={t('settings.addSource.replace', { name: source.name })}
          title={t('settings.addSource.replace', { name: source.name })}
          onClick={replace}
        />
      )}
      {retopic && (
        <RoundButton
          size={38}
          icon={Tags}
          label={t('sources.changeTopicsOf', { name: source.name })}
          title={t('sources.changeTopics')}
          onClick={retopic}
        />
      )}
      <RoundButton
        size={38}
        icon={ExternalLink}
        label={t('addSource.seeSite', { name: source.name })}
        title={t('sources.seeSite')}
        href={source.site}
        external
      />
      {deletable && (
        <RoundButton
          size={38}
          icon={Trash2}
          variant="danger"
          label={t('sources.deleteFor', { name: source.name })}
          title={t('profileForm.delete')}
          disabled={removing}
          onClick={onRemove}
        />
      )}
    </>
  )
}

interface SourceRowProps extends PhoneActionsProps {
  phone: boolean
  off: boolean
  // The profile that added it, when another one did.
  addedBy: string | null
  onShow: (visible: boolean) => void
}

// One row per source, as Réglages' other lists: its avatar, its name over its site, its buttons and its switch.
// The whole row shows or hides it.
const SourceRow = ({ phone, off, addedBy, onShow, ...actions }: SourceRowProps) => {
  const { t } = useTranslation()
  const { source } = actions
  const ago = shortAgo(source.fetchedAt)
  const error = sourceState(source) === 'error' && !off
  const errorTitle = error && source.error ? t('sources.errorTitle', { error: source.error }) : undefined
  const hint = [
    phone && error ? t('sources.status.error') : null,
    hostOf(source.site),
    addedBy && t('sources.by', { name: addedBy })
  ]
    .filter(Boolean)
    .join(' · ')
  // A click on the row, not on one of its buttons, flips its switch.
  const flip = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('button, a, [role="menu"]')) return
    onShow(off)
  }

  return (
    <li className={sourceStyles.row} onClick={flip}>
      <span className={`${sourceStyles.avatar} ${off ? styles.dim : ''}`}>
        <SourceAvatar sourceId={source.id} sourceName={source.name} size={44} />
      </span>
      <span className={`${styles.rowText} ${off ? styles.dim : ''}`}>
        <span className={`${styles.rowLabel} ${sourceStyles.name}`}>{source.name}</span>
        <span
          className={`${styles.rowHint} ${sourceStyles.name} ${phone && error ? sourceStyles.errorHint : ''}`}
          title={errorTitle}
        >
          {hint}
        </span>
      </span>
      {!phone && error && (
        <Chip tone="warning" size="row" title={errorTitle}>
          {`${t('sources.status.error')}${ago ? ` · ${ago}` : ''}`}
        </Chip>
      )}
      <span className={sourceStyles.actions}>
        {phone ? <PhoneActions {...actions} /> : <DesktopActions {...actions} />}
        <Toggle label={t('settings.themes.show', { name: source.name })} checked={!off} onChange={onShow} />
      </span>
    </li>
  )
}

export default SourceRow
