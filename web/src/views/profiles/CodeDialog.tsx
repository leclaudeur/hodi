import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { SIGN_IN_CODE_CHARACTERS, SIGN_IN_CODE_LENGTH, createSignInCode } from '../../api.ts'
import { closeAllLayers } from '../../lib/dialog-stack.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import Button from '../../ui/Button.tsx'
import Dialog from '../../ui/Dialog.tsx'
import DialogActions from '../../ui/DialogActions.tsx'
import PinField from '../../ui/PinField.tsx'
import QrCode from '../../ui/LazyQrCode.tsx'
import RichText from '../../ui/RichText.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import styles from './CodeDialog.module.css'

const COPIED_MS = 2000

interface CodeDialogProps {
  // undefined: closed. null: "Inviter un adulte"; a profile: "Connecter un appareil" for it (young: its own device;
  // reset: an adult who forgot their password).
  target: { id: number; name: string; young?: boolean; reset?: boolean } | null | undefined
  onClose: () => void
  // Where the code is made, when not by the household's route: Serveur › Foyers and Comptes make theirs.
  make?: () => Promise<{ code: string }>
}

// The code is made when the dialog opens, its link is what the QR holds: the Connexion page opens on it.
export const codeLink = (code: string) => `${window.location.origin}/#/code/${code}`

// A new code each time the dialog opens: what it holds is reset with the dialog (see CodeDialog's key).
const useSignInCode = (open: boolean, targetId: number | undefined, make: CodeDialogProps['make']) => {
  const [code, setCode] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(make ? make() : createSignInCode(targetId))
      .then(made => {
        if (!cancelled) setCode(made.code)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the code is made once per opening: a new `make` on each render does not make another
  }, [open, targetId])
  return { code, failed }
}

// The button says « Copié » for a moment, as Partager's « Copier le lien », and the toast says it too.
const useCopy = (code: string | null) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = () => {
    if (!code) return
    navigator.clipboard
      .writeText(codeLink(code))
      .then(() => {
        setCopied(true)
        showSaved(t('profiles.code.copied'))
      })
      .catch(() => showError(t('profiles.code.copyFailed')))
  }
  return { copied, copy }
}

const titleOf = (target: CodeDialogProps['target'], t: TFunction) => {
  if (target?.reset) return t('profiles.code.resetTitle')
  if (target) return t('profiles.code.connectTitle', { name: target.name })
  return t('profiles.code.inviteTitle')
}

const introKeyOf = (target: NonNullable<CodeDialogProps['target']>) => {
  if (target.reset) return 'profiles.code.resetIntro'
  if (target.young) return 'profiles.code.deviceIntro'
  return 'profiles.code.connectIntro'
}

// The code's characters and its QR, the QR's place kept while it is made.
const CodeBody = ({ code, failed }: { code: string | null; failed: boolean }) => {
  const { t } = useTranslation()
  if (failed) return <StatusLine tone="error">{t('profiles.code.failed')}</StatusLine>
  return (
    <>
      <PinField
        label={t('profiles.code.label')}
        length={SIGN_IN_CODE_LENGTH}
        characters={SIGN_IN_CODE_CHARACTERS}
        masked={false}
        align="start"
        disabled
        value={code ?? ''}
        onChange={() => {}}
      />
      <div className={styles.qr}>
        {code ? (
          <QrCode value={codeLink(code)} label={t('profiles.code.qr')} size={112} />
        ) : (
          <span className={styles.qrWait} aria-hidden="true" />
        )}
        <span className={styles.scan}>{t('profiles.code.scan')}</span>
      </div>
    </>
  )
}

// "Inviter un adulte" and "Connecter un appareil": eight characters and their QR, valid once and for a day. The person
// types them after « J'ai un code » on the Connexion page, or scans the QR.
const CodeDialog = ({ target, onClose, make }: CodeDialogProps) => {
  const { t } = useTranslation()
  const open = target !== undefined
  const { code, failed } = useSignInCode(open, target?.id, make)
  const { copied, copy } = useCopy(code)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={titleOf(target, t)}
      intro={
        target ? (
          <RichText i18nKey={introKeyOf(target)} values={{ name: target.name }} />
        ) : (
          <RichText i18nKey="profiles.code.inviteIntro" />
        )
      }
    >
      <div className={styles.body}>
        <CodeBody code={code} failed={failed} />
      </div>
      <DialogActions>
        <Button icon={copied ? Check : Copy} disabled={!code} onClick={copy}>
          {t(copied ? 'profiles.code.copiedButton' : 'profiles.code.copy')}
        </Button>
        {/* Done with the profile too, when it was opened from its dialog. */}
        <Button look="primary" onClick={closeAllLayers}>
          {t('profiles.code.done')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CodeDialog
