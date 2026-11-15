import type { FormEvent, ReactNode } from 'react'
import { Actions, SetupFrame, StepHeader } from '../pages/SetupParts.tsx'
import styles from '../pages/SetupPage.module.css'

interface StepPageProps {
  // From 1 with total, the bars above the title (« 2 / 3 »); without, none.
  step?: number
  total?: number
  title: string
  intro: ReactNode
  // The step's form: the page submits it with Enter, from any field.
  onSubmit?: () => void
  // « Retour » on the left; start, one more button there (« Plus tard »).
  onBack?: () => void
  start?: ReactNode
  // The step's buttons on the right, its primary one last (« Continuer »).
  actions: ReactNode
  children?: ReactNode
}

// A full-page step, as the setup's and « J'ai un code »'s: the logo and the language at the top, a card with the
// step's progress, title and line, its fields, then its buttons, and the licence at the foot.
const StepPage = ({ step, total, title, intro, onSubmit, onBack, start, actions, children }: StepPageProps) => {
  const body = (
    <>
      <StepHeader step={step} total={total} title={title} intro={intro} />
      {children}
      <Actions onBack={onBack} start={start}>
        {actions}
      </Actions>
    </>
  )
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit?.()
  }
  return (
    <SetupFrame>
      {onSubmit ? (
        <form className={styles.form} onSubmit={submit}>
          {body}
        </form>
      ) : (
        <div className={styles.form}>{body}</div>
      )}
    </SetupFrame>
  )
}

export default StepPage
