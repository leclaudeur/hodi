import { ArrowLeft, ArrowRight, Check, CircleSlash, Clock, Home, KeyRound, MapPin } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AiProviderInfo,
  type KeyCheck,
  MAX_HOUSEHOLD_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  RequestError,
  SETUP_CODE_LENGTH,
  type SetupState,
  checkSetupCode,
  checkSetupKey,
  getSetup,
  setUpHousehold,
  uploadProfilePhoto
} from '../api.ts'
import { LANGUAGES, LANGUAGE_NAMES, setChosenLanguage, t as textNow, useLanguage } from '../lib/i18n.ts'
import { passwordStrength } from '../lib/password-strength.ts'
import { dataUrlOf } from '../lib/profiles.ts'
import { blobOf, clearSetupDraft, loadSetupDraft, saveSetupDraft } from '../lib/setup-draft.ts'
import { countryName, deviceCountry, deviceTimeZone, timeZoneCity, timeZoneOffset } from '../lib/regions.ts'
import { useIsDesktop } from '../lib/use-media.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import HelpButton from '../ui/HelpButton.tsx'
import Logo from '../ui/Logo.tsx'
import PasswordField from '../ui/PasswordField.tsx'
import PasswordGauge from '../ui/PasswordGauge.tsx'
import PinField from '../ui/PinField.tsx'
import Segmented from '../ui/Segmented.tsx'
import SparkleIcon from '../ui/SparkleIcon.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import TextField from '../ui/TextField.tsx'
import AiKeyField from '../views/household/AiKeyField.tsx'
import householdStyles from '../views/household/Household.module.css'
import { CountryPicker, TimeZonePicker } from '../views/household/RegionPickers.tsx'
import ProfileForm, { type ProfileDraft } from '../views/profiles/ProfileForm.tsx'
import SettingRow from '../views/settings/SettingRow.tsx'
import settingsStyles from '../views/settings/Settings.module.css'
import styles from './SetupPage.module.css'

// 0: welcome (and the code, away from the server); 1 to 4: household, admin profile, AI, recap.
type Step = 0 | 1 | 2 | 3 | 4
const STEPS = 4
const NO_AI = 'none'

interface StepHeaderProps {
  step: Step
  title: string
  intro: ReactNode
  help?: { id: string; title: string; body: ReactNode }
}

// The step's index, its title with its "?", and its line.
const StepHeader = ({ step, title, intro, help }: StepHeaderProps) => {
  const desktop = useIsDesktop()
  const { t } = useTranslation()
  return (
    <header className={styles.header}>
      {step > 0 && (
        <div className={styles.stepper}>
          <span className={styles.stepLabel}>{t('setup.step', { step, total: STEPS })}</span>
          <div className={styles.bars} aria-hidden="true">
            {Array.from({ length: STEPS }, (_, index) => (
              <span key={index} className={index < step ? styles.done : undefined} />
            ))}
          </div>
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
      <p className={styles.intro}>{intro}</p>
    </header>
  )
}

const Actions = ({ onBack, children }: { onBack?: () => void; children: ReactNode }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.actions}>
      {onBack && (
        <Button icon={ArrowLeft} onClick={onBack}>
          {t('common.back')}
        </Button>
      )}
      <span className={styles.spacer} />
      {children}
    </div>
  )
}

// The server's refusals that the person can act on; anything else gets the step's own message.
const refusal = (failure: unknown, fallback: string) => {
  if (failure instanceof RequestError && failure.code === 'invalid_code') return textNow('setup.codeWrong')
  if (failure instanceof RequestError && failure.code === 'too_many_attempts')
    return textNow('common.tooManyAttempts', { minutes: Math.ceil((failure.retryAfterSeconds ?? 900) / 60) })
  return fallback
}

interface SetupPageProps {
  // Set up (here or on another device): the app checks the session again.
  onDone: () => void
}

// The first visit of a new install: the household, its admin, the AI if wanted, the region. Nothing reaches the
// server until the last step's button; then this device is signed in as the admin. Until then the answers are kept
// on this device, so the setup resumes later, all but the password and the AI key: those are typed again.
const SetupPage = ({ onDone }: SetupPageProps) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const [draft] = useState(loadSetupDraft)
  const [setup, setSetup] = useState<Extract<SetupState, { needed: true }> | null>(null)
  // Past the household, a resumed setup first asks for the password again (and the key, if an AI was chosen).
  const passwordGone = draft !== null && draft.step >= 2
  const [step, setStep] = useState<Step>(passwordGone ? 1 : (draft?.step ?? 0))
  const [code, setCode] = useState(draft?.code ?? '')
  const [codeWrong, setCodeWrong] = useState(false)
  // Where the setup goes on once the code (after a restart) or the password (after a pause) is typed again.
  const [resumeFrom] = useState<Step | null>(() =>
    passwordGone && draft ? (draft.step === 4 && draft.ai !== NO_AI ? 3 : draft.step) : null
  )
  const [resumeStep, setResumeStep] = useState<Step | null>(resumeFrom)

  const [notice, setNotice] = useState<string | null>(null)
  const [name, setName] = useState(draft?.name ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [profile, setProfile] = useState<ProfileDraft | null>(() =>
    draft?.profile ? { ...draft.profile, photo: draft.profile.photo ? blobOf(draft.profile.photo) : null } : null
  )
  const [photoUrl, setPhotoUrl] = useState<string | null>(draft?.profile?.photo ?? null)
  const [ai, setAi] = useState<string>(draft?.ai ?? NO_AI)
  const [key, setKey] = useState('')
  const [keyCheck, setKeyCheck] = useState<KeyCheck | null>(null)
  const [timeZone, setTimeZone] = useState(draft?.timeZone ?? deviceTimeZone)
  const [country, setCountry] = useState<string | null>(draft ? draft.country : deviceCountry)
  const [picking, setPicking] = useState<'timeZone' | 'country' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSetup()
      .then(async state => {
        if (!state.needed) {
          // Set up from another device: this one's unfinished answers are of no use any more.
          clearSetupDraft()
          onDone()
          return
        }
        // The code changes with each start of the server: a resumed setup checks the kept one before showing its
        // step, so a restart leads straight back to an empty code instead of failing on the last button.
        if (state.codeRequired && draft && draft.code.length === SETUP_CODE_LENGTH) {
          await recheckCode(draft.code, resumeFrom)
        }
        setSetup(state)
      })
      .catch(() => setError(textNow('common.unreachable')))
  }, [draft, onDone, resumeFrom])

  useEffect(() => {
    saveSetupDraft({
      step,
      code,
      name,
      profile: profile && { name: profile.name, color: profile.color, photo: photoUrl },
      ai,
      timeZone,
      country
    })
  }, [step, code, name, profile, photoUrl, ai, timeZone, country])

  // A kept code refused: the server restarted since it was typed. The field empties, and the setup comes back to
  // `from` once the new code is in.
  async function recheckCode(kept: string, from: Step | null) {
    try {
      await checkSetupCode(kept)
      return true
    } catch (failure) {
      if (failure instanceof RequestError && failure.code === 'invalid_code') {
        setCode('')
        setResumeStep(from)
        setStep(0)
        setNotice(textNow('setup.restarted'))
        return false
      }
      if (failure instanceof RequestError && failure.code === 'too_many_attempts') {
        setStep(0)
        setError(refusal(failure, ''))
        return false
      }
      // Not reachable right now: the last button checks the code again anyway.
      return true
    }
  }

  // Back on the code: checked first, so a code that is no longer valid never shows.
  const backToCode = async () => {
    if (setup?.codeRequired && code.length === SETUP_CODE_LENGTH) {
      setBusy(true)
      const valid = await recheckCode(code, resumeStep ?? 1)
      setBusy(false)
      if (!valid) return
    }
    go(0)
  }

  const go = (next: Step) => {
    setError(null)
    setStep(next)
    window.scrollTo({ top: 0 })
  }

  const codeOrNull = setup?.codeRequired ? code : null
  const provider: AiProviderInfo | null = setup?.providers.find(candidate => candidate.id === ai) ?? null

  // As a profile's PIN: checked as soon as its 6 digits are typed, or with "Commencer".
  const checkCode = async (typed: string) => {
    setBusy(true)
    setError(null)
    setCodeWrong(false)
    try {
      await checkSetupCode(typed)
      setNotice(null)
      // Without its password, the setup goes through the household before going on.
      if (resumeStep !== null && resumeStep >= 2 && password === '') return go(1)
      go(resumeStep ?? 1)
      setResumeStep(null)
    } catch (failure) {
      setCodeWrong(failure instanceof RequestError && failure.code === 'invalid_code')
      setError(refusal(failure, t('setup.codeCheckFailed')))
    } finally {
      setBusy(false)
    }
  }

  const start = (event: FormEvent) => {
    event.preventDefault()
    if (setup?.codeRequired) void checkCode(code)
    else go(1)
  }

  const finish = async () => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      const { profileId } = await setUpHousehold({
        code: codeOrNull,
        name: name.replace(/\s+/g, ' ').trim(),
        password,
        profile: { name: profile.name, color: profile.color },
        timeZone,
        country: provider ? country : null,
        language,
        ai: provider ? { provider: provider.id, key: key.trim() } : null
      })
      // The photo once signed in; the household is set up whatever happens to it.
      if (profile.photo && profileId !== null) await uploadProfilePhoto(profileId, profile.photo).catch(() => {})
      clearSetupDraft()
      onDone()
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 409) {
        clearSetupDraft()
        onDone()
        return
      }
      if (failure instanceof RequestError && failure.code === 'invalid_code') {
        setCode('')
        setResumeStep(step)
        setStep(0)
        setNotice(textNow('setup.restarted'))
        setBusy(false)
        return
      }
      setError(refusal(failure, t('setup.setupFailed')))
      setBusy(false)
    }
  }

  const strongEnough = passwordStrength(password).score > 0
  const householdReady = name.trim() !== '' && strongEnough && password === confirm

  let content: ReactNode = null
  if (!setup) {
    content = error && <StatusLine tone="error">{error}</StatusLine>
  } else if (step === 0) {
    content = (
      <form className={styles.form} onSubmit={start}>
        <StepHeader
          step={0}
          title={t('setup.start.title')}
          intro={t('setup.start.intro')}
          help={
            setup.codeRequired
              ? {
                  id: 'setup-code',
                  title: t('setup.start.codeHelpTitle'),
                  body: (
                    <>
                      <p>{t('setup.start.codeHelpWhy')}</p>
                      <p>
                        {t('setup.start.codeHelpServer')}{' '}
                        <code>docker compose logs app | grep "Setup code" | tail -1</code>.{' '}
                        {t('setup.start.codeHelpLocal')}
                      </p>
                    </>
                  )
                }
              : undefined
          }
        />
        {setup.codeRequired && (
          <PinField
            label={t('setup.start.code')}
            length={SETUP_CODE_LENGTH}
            masked={false}
            align="start"
            autoFocus
            disabled={busy}
            state={codeWrong ? 'wrong' : 'idle'}
            value={code}
            onChange={typed => {
              setCode(typed)
              setCodeWrong(false)
            }}
            onComplete={typed => void checkCode(typed)}
          />
        )}
        {notice && !error && (
          <StatusLine tone="info" className={styles.codeStatus}>
            {notice}
          </StatusLine>
        )}
        {error && (
          <StatusLine tone="error" className={styles.codeStatus}>
            {error}
          </StatusLine>
        )}
        <Actions>
          <Button
            type="submit"
            look="primary"
            busy={busy}
            disabled={setup.codeRequired && code.length !== SETUP_CODE_LENGTH}
          >
            {t('setup.start.button')}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </Actions>
      </form>
    )
  } else if (step === 1) {
    content = (
      <form
        className={styles.form}
        onSubmit={event => {
          event.preventDefault()
          if (!householdReady) return
          go(resumeStep !== null && resumeStep >= 2 ? resumeStep : 2)
          setResumeStep(null)
        }}
      >
        <StepHeader
          step={1}
          title={t('setup.household.title')}
          intro={t('setup.household.intro')}
          help={{
            id: 'setup-household',
            title: t('setup.household.helpTitle'),
            body: <p>{t('setup.household.help')}</p>
          }}
        />
        <label className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('setup.household.name')}</span>
          <TextField
            icon={Home}
            aria-label={t('setup.household.name')}
            placeholder={t('setup.household.namePlaceholder')}
            maxLength={MAX_HOUSEHOLD_NAME_LENGTH}
            autoFocus
            required
            value={name}
            onChange={event => setName(event.target.value)}
          />
        </label>
        <div className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('setup.household.password')}</span>
          <PasswordField
            aria-label={t('setup.household.password')}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
          <PasswordGauge password={password} />
        </div>
        <div className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('setup.household.confirm')}</span>
          <PasswordField
            icon={KeyRound}
            aria-label={t('setup.household.confirm')}
            autoComplete="new-password"
            required
            invalid={confirm !== '' && confirm !== password}
            value={confirm}
            onChange={event => setConfirm(event.target.value)}
          />
          {confirm !== '' && confirm !== password && (
            <StatusLine tone="error">{t('setup.household.mismatch')}</StatusLine>
          )}
        </div>
        {resumeStep !== null && resumeStep >= 2 && (
          <StatusLine tone="info">{t('setup.household.typeAgain')}</StatusLine>
        )}
        <Actions onBack={() => void backToCode()}>
          <Button type="submit" look="primary" disabled={!householdReady}>
            {t('common.continue')}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </Actions>
      </form>
    )
  } else if (step === 2) {
    content = (
      <div className={styles.form}>
        <StepHeader step={2} title={t('setup.profile.title')} intro={t('setup.profile.intro')} />
        <ProfileForm
          initial={profile ?? undefined}
          className={styles.profileForm}
          submitLabel={
            <>
              {t('common.continue')}
              <ArrowRight size={16} aria-hidden="true" />
            </>
          }
          cancelLabel={
            <>
              <ArrowLeft size={16} aria-hidden="true" />
              {t('common.back')}
            </>
          }
          onCancel={() => go(1)}
          onSave={async next => {
            // A photo left unchanged keeps the one already chosen.
            const photo = next.photo === undefined ? (profile?.photo ?? null) : next.photo
            setProfile({ ...next, photo })
            setPhotoUrl(photo ? await dataUrlOf(photo).catch(() => null) : null)
            go(3)
          }}
        />
      </div>
    )
  } else if (step === 3) {
    content = (
      <form
        className={styles.form}
        onSubmit={event => {
          event.preventDefault()
          go(4)
        }}
      >
        <StepHeader
          step={3}
          title={t('setup.ai.title')}
          intro={t('setup.ai.intro')}
          help={{
            id: 'setup-ai',
            title: t('setup.ai.helpTitle'),
            body: <p>{t('setup.ai.help')}</p>
          }}
        />
        <div className={styles.choices} role="radiogroup" aria-label={t('setup.ai.label')}>
          {setup.providers.map(option => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={ai === option.id}
              className={`${styles.choice} ${styles.aiChoice}`}
              onClick={() => setAi(option.id)}
            >
              <span className={styles.choiceMark}>
                <SparkleIcon size={18} />
              </span>
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{option.name}</span>
                <span className={styles.choiceHint}>{t('setup.ai.providerHint')}</span>
              </span>
              <ChoiceCheck checked={ai === option.id} />
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={ai === NO_AI}
            className={styles.choice}
            onClick={() => setAi(NO_AI)}
          >
            <span className={styles.choiceMark}>
              <CircleSlash size={18} aria-hidden="true" />
            </span>
            <span className={styles.choiceText}>
              <span className={styles.choiceLabel}>{t('setup.ai.none')}</span>
              <span className={styles.choiceHint}>{t('setup.ai.noneHint')}</span>
            </span>
            <ChoiceCheck checked={ai === NO_AI} />
          </button>
        </div>
        {provider && (
          <AiKeyField
            provider={provider}
            value={key}
            onChange={setKey}
            result={keyCheck}
            onResult={setKeyCheck}
            check={(id, typed) => checkSetupKey(codeOrNull, id, typed)}
          />
        )}
        {/* Only the AI's web searches use it: asked with the AI only. */}
        {provider && (
          <div className={settingsStyles.card}>
            <SettingRow label={t('regions.country')} hint={t('setup.ai.countryHint')}>
              <Button icon={MapPin} onClick={() => setPicking('country')}>
                {country ? countryName(country) : t('common.none')}
              </Button>
            </SettingRow>
          </div>
        )}
        <CountryPicker
          open={picking === 'country'}
          value={country}
          onPick={setCountry}
          onClose={() => setPicking(null)}
        />
        <Actions onBack={() => go(2)}>
          <Button type="submit" look="primary" disabled={provider !== null && keyCheck !== 'ok'}>
            {t('common.continue')}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </Actions>
      </form>
    )
  } else {
    content = (
      <div className={styles.form}>
        <StepHeader step={4} title={t('setup.done.title')} intro={t('setup.done.intro')} />
        <div className={settingsStyles.card}>
          <SettingRow label={t('regions.timeZone')} hint={`${timeZone} · ${timeZoneOffset(timeZone)}`}>
            <Button icon={Clock} onClick={() => setPicking('timeZone')}>
              {timeZoneCity(timeZone)}
            </Button>
          </SettingRow>
          <SettingRow
            label={t('setup.done.household')}
            hint={t('setup.done.admin', { household: name.trim(), profile: profile?.name ?? '' })}
          />
          <SettingRow
            label={t('setup.done.ai')}
            hint={provider ? t('setup.done.keyChecked', { provider: provider.name }) : t('setup.ai.none')}
          />
        </div>
        {error && <StatusLine tone="error">{error}</StatusLine>}
        <Actions onBack={() => go(3)}>
          <Button look="primary" busy={busy} onClick={() => void finish()}>
            {t('setup.done.enter')}
            {!busy && <ArrowRight size={16} aria-hidden="true" />}
          </Button>
        </Actions>
        <TimeZonePicker
          open={picking === 'timeZone'}
          value={timeZone}
          onPick={setTimeZone}
          onClose={() => setPicking(null)}
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <Logo size={34} />
        <Segmented
          label={t('language.label')}
          value={language}
          onChange={setChosenLanguage}
          options={LANGUAGES.map(option => ({
            value: option,
            title: LANGUAGE_NAMES[option],
            label: option.toUpperCase()
          }))}
        />
      </div>
      <main className={styles.main}>{content}</main>
      <footer>
        <Copyright className={styles.copyright} />
      </footer>
    </div>
  )
}

export default SetupPage

// The chosen card's mark, as the worn badge in the profile sheet: a filled round over its top-right corner.
const ChoiceCheck = ({ checked }: { checked: boolean }) =>
  checked && (
    <span className={styles.choiceCheck} aria-hidden="true">
      <Check size={12} strokeWidth={3} />
    </span>
  )
