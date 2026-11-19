import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsDesktop } from '../lib/use-media.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import DialogActions from '../ui/DialogActions.tsx'
import HelpButton from '../ui/HelpButton.tsx'
import Logo from '../ui/Logo.tsx'
import PageGlows from '../ui/PageGlows.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import LanguageRound from '../ui/LanguageRound.tsx'
import styles from './SetupPage.module.css'
import { rich } from '../ui/rich.tsx'

// The pieces of the first-run screens, shared with the other full-page steps of the same kind.

// The logo and the language at the top, the step in the middle, the licence at the foot, the glows behind.
export const SetupFrame = ({ children }: { children: ReactNode }) => (
  <div className={styles.page}>
    <PageGlows />
    <div className={styles.top}>
      <Logo size={34} />
      <LanguageRound />
    </div>
    <main className={styles.main}>{children}</main>
    <footer>
      <Copyright className={styles.copyright} />
    </footer>
  </div>
)

interface StepHeaderProps {
  // From 1 with total, the stepper above the title; without, none.
  step?: number
  total?: number
  title: string
  intro: ReactNode
  help?: { id: string; title: string; body: ReactNode }
}

// The step's index and its title with its "?", then its line.
export const StepHeader = ({ step = 0, total = 0, title, intro, help }: StepHeaderProps) => {
  const desktop = useIsDesktop()
  // As a tour step: the progress and the title in the header, the text in the body, as a dialog's.
  return (
    <>
      <header className={styles.header}>
        {step > 0 && total > 0 && (
          <div className={styles.stepper}>
            <div className={styles.bars} aria-hidden="true">
              {Array.from({ length: total }, (_, index) => (
                <span key={index} className={index < step ? styles.done : undefined} />
              ))}
            </div>
            <span className={styles.count}>
              {step} / {total}
            </span>
          </div>
        )}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {help && (
            <HelpButton id={help.id} title={help.title} layout={desktop ? 'desktop' : 'phone'}>
              {help.body}
            </HelpButton>
          )}
        </div>
      </header>
      <p className={styles.intro}>{rich(intro)}</p>
    </>
  )
}

// start: a secondary action in place of « Retour », on the left.
export const Actions = ({
  onBack,
  start,
  children
}: {
  onBack?: () => void
  start?: ReactNode
  children: ReactNode
}) => {
  const { t } = useTranslation()
  // With a third button, « Retour » keeps only its arrow at every size, so the footer holds one line.
  const round = start != null
  return (
    <DialogActions className={`${styles.actions} ${round ? styles.three : ''}`}>
      {onBack &&
        (round ? (
          <RoundButton icon={ArrowLeft} label={t('common.back')} size={44} onClick={onBack} />
        ) : (
          <Button icon={ArrowLeft} onClick={onBack}>
            {t('common.back')}
          </Button>
        ))}
      {start}
      <span className={styles.spacer} />
      {children}
    </DialogActions>
  )
}
