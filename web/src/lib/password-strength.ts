import type { ZxcvbnFactory } from '@zxcvbn-ts/core'
import { useEffect, useState } from 'react'
import { MIN_PASSWORD_LENGTH } from '../api.ts'
import { t } from './i18n.ts'

// The gauge under a new password: 0 (too short) to 4, and what would take it one step further.
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
  // What to add, or null at the top.
  hint: string | null
}

const label = (score: number) =>
  [
    t('password.levels.tooShort'),
    t('password.levels.weak'),
    t('password.levels.fair'),
    t('password.levels.strong'),
    t('password.levels.excellent')
  ][score] ?? ''

// zxcvbn-ts finds what makes a password easy to guess (common passwords, words, names, dates, keyboard rows,
// repeats) in French and English. Its dictionaries weigh about a megabyte: they load when a gauge first shows.
let estimator: ZxcvbnFactory | null = null
let loading: Promise<void> | null = null

const loadEstimator = () =>
  (loading ??= Promise.all([
    import('@zxcvbn-ts/core'),
    import('@zxcvbn-ts/language-common'),
    import('@zxcvbn-ts/language-fr'),
    import('@zxcvbn-ts/language-en')
  ]).then(([{ ZxcvbnFactory }, common, fr, en]) => {
    estimator = new ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...fr.dictionary, ...en.dictionary },
      graphs: common.adjacencyGraphs
    })
  }))

// zxcvbn-ts names what it found by a key: each kind gets one tip of ours, in the locale files.
type Tip = 'keyboard' | 'repeat' | 'dates' | 'common' | 'word'

const TIPS: Record<string, Tip> = {
  straightRow: 'keyboard',
  keyPattern: 'keyboard',
  simpleRepeat: 'repeat',
  extendedRepeat: 'repeat',
  sequences: 'repeat',
  recentYears: 'dates',
  dates: 'dates',
  topTen: 'common',
  topHundred: 'common',
  common: 'common',
  similarToCommon: 'common',
  pwned: 'common',
  wordByItself: 'word',
  namesByThemselves: 'word',
  commonNames: 'word',
  userInputs: 'word'
}

const tipOf = (warning: string | null, level: string): string => {
  const tip = warning ? TIPS[warning] : undefined
  return tip ? t(`password.tips.${tip}` as const) : t('password.another', { level })
}

// Too short, the length decides alone, so a form can tell right away whether the password is long enough. Past the
// minimum, zxcvbn-ts scores it once loaded (at least "Faible": the minimum is met).
export const passwordStrength = (password: string): PasswordStrength => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    const missing = MIN_PASSWORD_LENGTH - password.length
    return {
      score: 0,
      label: label(0),
      hint:
        password.length === 0
          ? t('password.minimum', { count: MIN_PASSWORD_LENGTH })
          : t('password.missing', { count: missing })
    }
  }
  // Until then, the first step up is the usual advice.
  if (!estimator) return { score: 1, label: label(1), hint: t('password.another', { level: label(2) }) }
  const { score: found, feedback } = estimator.check(password)
  const score = Math.max(1, found) as PasswordStrength['score']
  return { score, label: label(score), hint: score === 4 ? null : tipOf(feedback.warning, label(score + 1)) }
}

// The strength of a password being typed, scored by zxcvbn-ts as soon as its dictionaries are in.
export const usePasswordStrength = (password: string) => {
  const [ready, setReady] = useState(estimator !== null)
  useEffect(() => {
    if (!ready) void loadEstimator().then(() => setReady(true))
  }, [ready])
  return passwordStrength(password)
}
