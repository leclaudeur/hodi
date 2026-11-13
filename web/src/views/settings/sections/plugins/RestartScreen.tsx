import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useIsPhone } from '../../../../lib/use-media.ts'
import { type RestartStep, restartPercent, waitForRestart } from '../../../../plugins/restart.ts'
import pickerStyles from '../../../../pages/ProfilePicker.module.css'
import Button from '../../../../ui/Button.tsx'
import Copyright from '../../../../ui/Copyright.tsx'
import PhoneHeader from '../../../../ui/PhoneHeader.tsx'
import styles from './RestartScreen.module.css'

// "Hodi redémarre": over the whole page while Hodi restarts on its new plugins, then the page reloads on them. The
// same calm page as "À demain": the logo, one round picture (here the progress), a title, one sentence.
// change: the request that makes Hodi restart, resolving to the boot id Hodi answered with before it, so an answer
// from the old start never counts. The screen shows while it runs, so the page never shows between a closing
// question and this screen. onFailed: the request itself failed, and nothing restarts.
interface RestartScreenProps {
  change: Promise<string | null>
  step: string
  onFailed: () => void
}

// Waiting for Hodi to come back on its new start, the number moving meanwhile; too slow, a way to wait again.
const useRestart = (change: Promise<string | null>, onFailed: () => void) => {
  const [slow, setSlow] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [stage, setStage] = useState<{ step: RestartStep; since: number }>(() => ({ step: 'sent', since: Date.now() }))
  const [percent, setPercent] = useState(0)

  useEffect(() => {
    let cancelled = false
    void change
      .then(before =>
        waitForRestart(before, {
          onStopped: () => !cancelled && setStage({ step: 'stopped', since: Date.now() })
        })
      )
      .then(
        back => {
          if (cancelled) return
          if (!back) return setSlow(true)
          setStage({ step: 'back', since: Date.now() })
          // 100 % shown a moment before the page goes.
          // eslint-disable-next-line @eslint-react/web-api-no-leaked-timeout -- the page reloads: nothing outlives it
          setTimeout(() => window.location.reload(), 400)
        },
        () => !cancelled && onFailed()
      )
    return () => {
      cancelled = true
    }
  }, [change, attempt, onFailed])

  // The number moves on its own between two real steps, slower and slower, never past the next one.
  useEffect(() => {
    const tick = () => setPercent(restartPercent(stage.step, Date.now() - stage.since))
    tick()
    const timer = setInterval(tick, 200)
    return () => clearInterval(timer)
  }, [stage])

  const retry = () => {
    setSlow(false)
    setStage({ step: 'sent', since: Date.now() })
    setAttempt(value => value + 1)
  }
  return { slow, percent, retry }
}

// One round picture: the progress, with its number in the middle.
const ProgressRing = ({ size, percent, slow }: { size: number; percent: number; slow: boolean }) => {
  const { i18n } = useTranslation()
  const radius = size / 2 - 4
  const length = 2 * Math.PI * radius
  return (
    <div
      className={styles.progress}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={slow ? undefined : percent}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className={styles.track} cx={size / 2} cy={size / 2} r={radius} />
        <circle
          className={styles.bar}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - percent / 100)}
        />
      </svg>
      <span className={styles.percent}>
        {new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(percent / 100)}
      </span>
    </div>
  )
}

const RestartScreen = ({ change, step, onFailed }: RestartScreenProps) => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const screen = useRef<HTMLDialogElement>(null)

  // A modal dialog of its own, so it rises in the top layer over a dialog still open (Ajouter un plugin) rather than
  // under it: that one stays where it is until the page reloads, and nothing flashes between the two.
  useEffect(() => {
    const element = screen.current
    if (element && !element.open) element.showModal()
  }, [])

  const { slow, percent, retry } = useRestart(change, onFailed)

  return createPortal(
    <dialog
      ref={screen}
      className={`${pickerStyles.page} ${styles.screen}`}
      aria-labelledby="restart-title"
      // Nothing to go back to: Escape leaves the screen where it is.
      onCancel={event => event.preventDefault()}
    >
      <PhoneHeader logo className={pickerStyles.header} />
      <div className={`${pickerStyles.content} ${styles.content}`}>
        {/* A fifth smaller than "À demain"'s face: a loader, not the page's subject. */}
        <ProgressRing size={phone ? 88 : 100} percent={percent} slow={slow} />
        <h1 id="restart-title" className={`${pickerStyles.title} ${styles.title}`}>
          {t(slow ? 'plugins.restart.slowTitle' : 'plugins.restart.title')}
        </h1>
        <p className={styles.text}>{slow ? t('plugins.restart.slowText') : t('plugins.restart.text')}</p>
        {slow ? (
          <Button icon={RefreshCw} className={styles.retry} onClick={retry}>
            {t('common.retry')}
          </Button>
        ) : (
          <p className={styles.step}>
            {step}
            {/* Three dots that light up in turn: still working. */}
            <span className={styles.dots} aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
        )}
      </div>
      <Copyright />
    </dialog>,
    document.body
  )
}

export default RestartScreen
