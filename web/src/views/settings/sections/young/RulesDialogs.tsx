import { Moon, Sun } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DAILY_MINUTES,
  MAX_EXPLAIN_PER_DAY,
  type TimeRange,
  type YouthLimits,
  type YouthRules,
  setYouthRules
} from '../../../../api.ts'
import { showError, showSaved } from '../../../../lib/toast.ts'
import Button from '../../../../ui/Button.tsx'
import DialogActions from '../../../../ui/DialogActions.tsx'
import StatusLine from '../../../../ui/StatusLine.tsx'
import Stepper from '../../../../ui/Stepper.tsx'
import { hourText } from '../../../../lib/format.ts'
import TimeRangeField from '../../../../ui/TimeRangeField.tsx'
import Toggle from '../../../../ui/Toggle.tsx'
import settingsStyles from '../../Settings.module.css'
import { formatMinutes } from './format.ts'
import styles from './Young.module.css'

interface RuleDialogProps {
  profileId: number
  rules: YouthRules
  onCancel: () => void
  onSaved: (limits: YouthLimits) => void
}

// What every rule's dialog shares: its form, saved as one change, and its two answers.
const RuleForm = ({
  profileId,
  change,
  ready = true,
  onCancel,
  onSaved,
  children
}: Omit<RuleDialogProps, 'rules'> & { change: Partial<YouthRules>; ready?: boolean; children: ReactNode }) => {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    setSaving(true)
    try {
      onSaved(await setYouthRules(profileId, change))
      showSaved(t('young.saved'))
    } catch {
      showError(t('young.saveFailed'))
      setSaving(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {children}
      <DialogActions>
        <Button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" look="primary" busy={saving} disabled={!ready}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </form>
  )
}

// A switch with its name and line, at the top of a rule's dialog.
const SwitchRow = ({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) => (
  <div className={styles.switchRow}>
    <span className={settingsStyles.rowText}>
      <span className={settingsStyles.rowLabel}>{label}</span>
      <span className={settingsStyles.rowHint}>{hint}</span>
    </span>
    <Toggle label={label} checked={checked} onChange={onChange} />
  </div>
)

const DEFAULT_DAILY_MINUTES = 90

// "Temps par jour": off, or 5 minutes to 4 hours by steps of 5 minutes.
export const DailyDialog = ({ rules, ...props }: RuleDialogProps) => {
  const { t } = useTranslation()
  const [on, setOn] = useState(rules.dailyMinutes !== null)
  const [minutes, setMinutes] = useState(rules.dailyMinutes ?? DEFAULT_DAILY_MINUTES)

  return (
    <RuleForm {...props} change={{ dailyMinutes: on ? minutes : null }}>
      <SwitchRow label={t('young.dailyToggle')} hint={t('young.dailyToggleHint')} checked={on} onChange={setOn} />
      {on && (
        <Stepper
          label={t('young.dailyTitle')}
          lessLabel={t('young.less')}
          moreLabel={t('young.more')}
          value={minutes}
          min={DAILY_MINUTES.min}
          max={DAILY_MINUTES.max}
          step={DAILY_MINUTES.step}
          fastSteps={DAILY_MINUTES.fastSteps}
          onChange={setMinutes}
        >
          {formatMinutes(minutes)}
        </Stepper>
      )}
    </RuleForm>
  )
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

// "Horaires" (within one day) and "Ne pas déranger" (may pass midnight): off, or from one hour to another.
export const RangeDialog = ({
  rules,
  rule,
  ...props
}: RuleDialogProps & {
  rule: 'window' | 'quiet'
}) => {
  const { t } = useTranslation()
  const fallback: TimeRange = rule === 'window' ? { start: '08:00', end: '20:00' } : { start: '20:30', end: '07:30' }
  const [on, setOn] = useState(rules[rule] !== null)
  const [range, setRange] = useState(rules[rule] ?? fallback)
  const valid = isTime(range.start) && isTime(range.end) && range.start !== range.end
  // The reading hours stay within a day.
  const backwards = rule === 'window' && valid && minutesOf(range.start) > minutesOf(range.end)

  return (
    <RuleForm {...props} change={{ [rule]: on ? range : null }} ready={!on || (valid && !backwards)}>
      <SwitchRow
        label={t(rule === 'window' ? 'young.windowToggle' : 'young.quietToggle')}
        hint={
          rule === 'window'
            ? t('young.windowToggleHint')
            : t('young.quietToggleHint', { start: hourText('20:00'), end: hourText('08:00') })
        }
        checked={on}
        onChange={setOn}
      />
      {on && (
        <TimeRangeField
          size="large"
          icon={rule === 'window' ? Sun : Moon}
          start={range.start}
          end={range.end}
          startLabel={t('young.start')}
          endLabel={t('young.end')}
          onChange={setRange}
        />
      )}
      {on && backwards && <StatusLine tone="error">{t('young.windowWrong')}</StatusLine>}
    </RuleForm>
  )
}

// "Explications IA par jour": how many times it may ask the AI, 0 to 20.
export const ExplainDialog = ({ rules, ...props }: RuleDialogProps) => {
  const { t } = useTranslation()
  const [count, setCount] = useState(rules.explainPerDay)

  return (
    <RuleForm {...props} change={{ explainPerDay: count }}>
      <Stepper
        label={t('young.explainTitle')}
        lessLabel={t('young.less')}
        moreLabel={t('young.more')}
        value={count}
        min={0}
        max={MAX_EXPLAIN_PER_DAY}
        step={1}
        onChange={setCount}
      >
        {count === 0 ? t('young.explainNone') : t('young.perDayCount', { count })}
      </Stepper>
    </RuleForm>
  )
}
