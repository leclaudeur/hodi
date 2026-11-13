import { FileUp, RefreshCw, ShieldAlert, ShieldCheck, Users } from 'lucide-react'
import { type DragEvent, type RefObject, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AdminProof, RequestError, type StagedPlugin, installPlugin, stagePlugin } from '../../../../api.ts'
import { askToConfirm } from '../../../../lib/confirm.ts'
import { currentBoot } from '../../../../plugins/restart.ts'
import Button from '../../../../ui/Button.tsx'
import Chip from '../../../../ui/Chip.tsx'
import Dialog from '../../../../ui/Dialog.tsx'
import DialogActions from '../../../../ui/DialogActions.tsx'
import RichText from '../../../../ui/RichText.tsx'
import StatusLine from '../../../../ui/StatusLine.tsx'
import SettingRow from '../../SettingRow.tsx'
import styles from '../../Settings.module.css'
import PluginPermissions from './PluginPermissions.tsx'
import own from './Plugins.module.css'
import { pluginName, pluginDescription } from '../../../../plugins/plugin-texts.ts'

interface AddPluginDialogProps {
  open: boolean
  onClose: () => void
  // Installed: Hodi restarts. before: the boot id it had until now.
  onInstalled: (name: string, before: string | null) => void
  // A package the server already downloaded from Hodi's registry: the dialog opens on what is in it.
  initial?: StagedPlugin | null
}

const ERRORS = ['too_big', 'not_a_package', 'invalid_manifest', 'not_found', 'signed_only'] as const

// The package chosen and read, its install after the questions, and the drop zone's state.
const useAddPlugin = (
  input: RefObject<HTMLInputElement | null>,
  { onClose, onInstalled, initial }: Omit<AddPluginDialogProps, 'open'>
) => {
  const { t } = useTranslation()
  const [staged, setStaged] = useState<StagedPlugin | null>(initial ?? null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setStaged(null)
    setError(null)
    onClose()
  }

  const failure = (caught: unknown) => {
    const code = caught instanceof RequestError ? caught.code : null
    return ERRORS.includes(code as (typeof ERRORS)[number])
      ? t(`plugins.add.errors.${code as (typeof ERRORS)[number]}`)
      : t('plugins.add.errors.failed')
  }

  const choose = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      setStaged(await stagePlugin(file))
    } catch (caught) {
      setError(failure(caught))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const install = async (plugin: StagedPlugin, proof: AdminProof) => {
    const before = await currentBoot()
    await installPlugin(plugin.token, !plugin.signed, proof)
    onInstalled(pluginName(plugin), before)
  }

  // A plugin reads and changes what its permissions allow, for everyone on the server: the server admin's password
  // first, and a stronger warning for unverified code. A wrong password stays in the question.
  const confirmInstall = (plugin: StagedPlugin) =>
    askToConfirm({
      title: t(plugin.signed ? 'plugins.confirmInstall.title' : 'plugins.confirmUnsigned.title', {
        name: pluginName(plugin)
      }),
      message: (
        <RichText
          i18nKey={plugin.signed ? 'plugins.confirmInstall.message' : 'plugins.confirmUnsigned.message'}
          values={{ name: pluginName(plugin) }}
        />
      ),
      label: t(plugin.signed ? 'plugins.confirmInstall.button' : 'plugins.confirmUnsigned.button'),
      look: plugin.signed ? 'primary' : 'danger',
      proof: {},
      onConfirm: async proof => {
        setError(null)
        try {
          await install(plugin, proof)
        } catch (caught) {
          // The question shows a wrong password; anything else, this dialog.
          if (caught instanceof RequestError && caught.code === 'invalid_password') throw caught
          setError(failure(caught))
        }
      }
    })

  // A file dragged over the zone lights it up; dropped, it is read as if chosen.
  const drag = (event: DragEvent, entering: boolean) => {
    event.preventDefault()
    if (!busy) setOver(entering)
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    if (!busy) void choose(event.dataTransfer.files[0])
  }

  return { staged, busy, over, error, close, choose, confirmInstall, drag, drop }
}

type AddPlugin = ReturnType<typeof useAddPlugin>

// Signed, signed-only permissions without a signature, or unsigned.
const trustOf = (staged: StagedPlugin, blocked: boolean) => {
  if (staged.signed) return 'signed'
  return blocked ? 'signedOnly' : 'unsigned'
}

// What is in the package: its name and version, whether a trusted key signed it, who it is for, what it replaces.
const StagedAbout = ({ staged, blocked }: { staged: StagedPlugin; blocked: boolean }) => {
  const { t } = useTranslation()
  const trust = trustOf(staged, blocked)
  const forAdmin = staged.audience === 'admin'
  return (
    // Its name with the version at the top right, so the description has the whole width under it.
    <div className={styles.card}>
      <div className={own.about}>
        <span className={own.aboutTitle}>
          <span className={styles.rowLabel}>{pluginName(staged)}</span>
          <Chip tone="success" size="row">
            {staged.version}
          </Chip>
        </span>
        <span className={styles.rowHint}>{pluginDescription(staged)}</span>
      </div>
      <SettingRow
        lead={
          <span className={`${own.shield} ${staged.signed ? own.signed : own.unsigned}`}>
            {staged.signed ? (
              <ShieldCheck size={20} aria-hidden="true" />
            ) : (
              <ShieldAlert size={20} aria-hidden="true" />
            )}
          </span>
        }
        label={t(`plugins.add.${trust}`)}
        hint={t(`plugins.add.${trust}Hint`)}
      />
      <SettingRow
        lead={
          <span className={own.mark}>
            <Users size={20} aria-hidden="true" />
          </span>
        }
        label={t(forAdmin ? 'plugins.add.forAdmin' : 'plugins.add.forAll')}
        hint={t(forAdmin ? 'plugins.add.forAdminHint' : 'plugins.add.forAllHint')}
      />
      {/* An update says which version it replaces; a new plugin has nothing more to say. */}
      {staged.replaces && (
        <SettingRow
          lead={
            <span className={own.mark}>
              <RefreshCw size={20} aria-hidden="true" />
            </span>
          }
          label={t('plugins.add.update')}
          hint={t('plugins.add.replaces', { version: staged.replaces })}
        />
      )}
    </div>
  )
}

const dropLabel = (busy: boolean, over: boolean) => {
  if (busy) return 'plugins.add.reading'
  return over ? 'plugins.add.dropHere' : 'plugins.add.choose'
}

// The zone a file is chosen in or dropped on.
const DropZone = ({ state, onPick }: { state: AddPlugin; onPick: () => void }) => {
  const { t } = useTranslation()
  const { busy, over, drag } = state
  return (
    <>
      <button
        type="button"
        className={`${own.drop} ${over ? own.over : ''}`}
        disabled={busy}
        onClick={onPick}
        onDragEnter={event => drag(event, true)}
        onDragOver={event => drag(event, true)}
        onDragLeave={event => drag(event, false)}
        onDrop={state.drop}
      >
        <FileUp size={22} aria-hidden="true" />
        <span className={own.dropLabel}>{t(dropLabel(busy, over))}</span>
        <span className={own.dropHint}>{t('plugins.add.dropHint')}</span>
      </button>
      {state.error && <StatusLine tone="error">{state.error}</StatusLine>}
    </>
  )
}

// The package read: what it is, what it may do, and installing it.
const StagedPackage = ({ staged, state }: { staged: StagedPlugin; state: AddPlugin }) => {
  const { t } = useTranslation()
  const blocked = !staged.signed && (staged.signedOnly ?? []).length > 0
  return (
    <>
      <StagedAbout staged={staged} blocked={blocked} />
      <PluginPermissions permissions={staged.permissions} feeds={staged.feeds ?? []} />
      {state.error && <StatusLine tone="error">{state.error}</StatusLine>}
      <DialogActions>
        <Button onClick={state.close} disabled={state.busy}>
          {t('common.cancel')}
        </Button>
        {/* Unsigned and asking for accounts, households, sign-ins, mail or notifications: only Annuler is left. */}
        {!blocked && (
          <Button
            look={staged.signed ? 'primary' : 'danger'}
            busy={state.busy}
            onClick={() => state.confirmInstall(staged)}
          >
            {t(staged.signed ? 'plugins.add.install' : 'plugins.add.installAnyway')}
          </Button>
        )}
      </DialogActions>
    </>
  )
}

// Serveur › Plugins › Ajouter un plugin: a .hodi-plugin file, chosen or dropped, what is in it, then installing it.
// A package no trusted key signed is said so in red, and installs only after a second question; one that also asks for
// a permission only verified plugins get cannot be installed at all.
const AddPluginDialog = ({ open, ...props }: AddPluginDialogProps) => {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const state = useAddPlugin(input, props)
  const { staged } = state

  return (
    <Dialog
      open={open}
      onClose={state.close}
      title={t('plugins.add.title')}
      intro={staged ? undefined : t('plugins.add.intro')}
    >
      <input
        ref={input}
        type="file"
        accept=".hodi-plugin,.tgz,application/gzip"
        hidden
        onChange={event => void state.choose(event.target.files?.[0])}
      />
      {staged ? (
        <StagedPackage staged={staged} state={state} />
      ) : (
        <DropZone state={state} onPick={() => input.current?.click()} />
      )}
    </Dialog>
  )
}

export default AddPluginDialog
