import { Code, Copy, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getDevMode, startDevMode, type AdminProof, stopDevMode } from '../../../../api.ts'
import { askToConfirm } from '../../../../lib/confirm.ts'
import { showError } from '../../../../lib/toast.ts'
import { currentBoot } from '../../../../plugins/restart.ts'
import Button from '../../../../ui/Button.tsx'
import Dialog from '../../../../ui/Dialog.tsx'
import DialogActions from '../../../../ui/DialogActions.tsx'
import Notice from '../../../../ui/Notice.tsx'
import RichText from '../../../../ui/RichText.tsx'
import Toggle from '../../../../ui/Toggle.tsx'
import SettingRow from '../../SettingRow.tsx'
import styles from '../../Settings.module.css'
import own from './Plugins.module.css'

// The command with its code, shown once: copied, then closed.
const DevCodeDialog = ({ code, onClose }: { code: string | null; onClose: () => void }) => {
  const { t } = useTranslation()
  const command = code ? `npx hodi-plugin dev --server ${window.location.origin} --code ${code}` : ''
  const copy = () => {
    navigator.clipboard?.writeText(command).catch(() => {})
  }
  return (
    <Dialog open={code !== null} onClose={onClose} title={t('plugins.devMode.codeTitle')}>
      <Notice tone="warning" icon={TriangleAlert} title={t('plugins.devMode.onceTitle')}>
        {t('plugins.devMode.once')}
      </Notice>
      <pre className={own.command}>{command}</pre>
      <DialogActions>
        <Button icon={Copy} onClick={copy}>
          {t('plugins.devMode.copy')}
        </Button>
        <Button look="primary" onClick={onClose}>
          {t('plugins.devMode.done')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Serveur › Plugins › Mode développeur, for whoever writes a plugin: a code for « npx hodi-plugin dev », which installs
// each build of the plugin as it is saved, its pages included although it is unsigned. Off by default; the code shows
// once, and turning the mode off stops it.
const DevMode = ({ onRestart }: { onRestart: (change: Promise<string | null>) => void }) => {
  const { t } = useTranslation()
  const [on, setOn] = useState<boolean | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getDevMode()
      .then(state => setOn(state.on))
      .catch(() => setOn(null))
  }, [])

  // A new code each time: the one before stops working. Only after the server admin's password.
  const makeCode = async (proof: AdminProof) => {
    const started = await startDevMode(proof)
    setOn(true)
    setCode(started.code)
  }

  const turnOn = () =>
    askToConfirm({
      title: t('plugins.devMode.confirm.title'),
      message: <RichText i18nKey="plugins.devMode.confirm.message" />,
      label: t('plugins.devMode.confirm.button'),
      proof: {},
      onConfirm: makeCode
    })

  const turnOff = async () => {
    setBusy(true)
    try {
      const before = await currentBoot()
      const stopped = await stopDevMode()
      setOn(false)
      // Its plugins lose their pages: Hodi restarts without them.
      if (stopped.restarting) onRestart(Promise.resolve(before))
    } catch {
      showError(t('plugins.devMode.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (on === null) return null
  return (
    <>
      <h2 className={styles.label}>{t('plugins.devMode.group')}</h2>
      <div className={styles.card}>
        <SettingRow
          lead={
            <span className={own.mark}>
              <Code size={20} aria-hidden="true" />
            </span>
          }
          label={t('plugins.devMode.label')}
          hint={on ? t('plugins.devMode.onHint') : <RichText i18nKey="plugins.devMode.hint" />}
        >
          <Toggle
            label={t('plugins.devMode.label')}
            checked={on}
            disabled={busy}
            onChange={next => (next ? turnOn() : void turnOff())}
          />
        </SettingRow>
        {on && (
          <SettingRow
            label={t('plugins.devMode.newCode')}
            hint={t('plugins.devMode.newCodeHint')}
            action={{ label: t('plugins.devMode.newCodeButton'), icon: RefreshCw, onClick: turnOn }}
          />
        )}
      </div>
      <DevCodeDialog code={code} onClose={() => setCode(null)} />
    </>
  )
}

export default DevMode
