import type { TFunction } from 'i18next'
import { ArrowLeft, ArrowRight, LogIn, Mail, UserPlus } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { type CodeUse, SIGN_IN_CODE_CHARACTERS, SIGN_IN_CODE_LENGTH } from '../api.ts'
import AgeCheckbox from '../plugins/AgeCheckbox.tsx'
import Button from '../ui/Button.tsx'
import NewPasswordFields from '../ui/NewPasswordFields.tsx'
import PasswordField from '../ui/PasswordField.tsx'
import PinField from '../ui/PinField.tsx'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import RichText from '../ui/RichText.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import TextField from '../ui/TextField.tsx'
import householdStyles from '../views/household/Household.module.css'
import ProfileForm from '../views/profiles/ProfileForm.tsx'
import loginStyles from './LoginPage.module.css'
import { Actions, StepHeader } from './SetupParts.tsx'
import styles from './SetupPage.module.css'
import type { Join } from './use-join.ts'

type Profiled = Extract<CodeUse, { profile: unknown }>

const Next = ({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) => (
  <Button type="submit" look="primary" busy={busy} disabled={disabled}>
    {children}
    {!busy && <ArrowRight size={16} aria-hidden="true" />}
  </Button>
)

const MemberRow = ({ use }: { use: Profiled }) => (
  <div className={styles.memberRow}>
    <ProfileAvatar profile={{ ...use.profile, photoVersion: null }} size={44} plain />
    <span className={styles.memberName}>{use.profile.name}</span>
  </div>
)

const ErrorLine = ({ error }: { error: string | null }) => error && <StatusLine tone="error">{error}</StatusLine>

const NewPassword = ({ join }: { join: Join }) => (
  <NewPasswordFields
    password={join.fields.password}
    confirm={join.fields.confirm}
    onPassword={join.fields.setPassword}
    onConfirm={join.fields.setConfirm}
    autoFocus={join.use?.kind === 'reset'}
  />
)

// The code an adult of the household gave.
export const CodeStep = ({ join, onBack }: { join: Join; onBack: () => void }) => {
  const { t } = useTranslation()
  const { code, busy } = join
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        if (code.length === SIGN_IN_CODE_LENGTH) void join.check(code)
      }}
    >
      <StepHeader
        title={t('join.code.title')}
        intro={t('join.code.intro')}
        help={{ id: 'join-code', title: t('join.code.helpTitle'), body: <p>{t('join.code.help')}</p> }}
      />
      <div className={householdStyles.field}>
        <PinField
          label={t('join.code.label')}
          length={SIGN_IN_CODE_LENGTH}
          characters={SIGN_IN_CODE_CHARACTERS}
          masked={false}
          align="start"
          autoFocus
          disabled={busy}
          state={join.codeWrong ? 'wrong' : 'idle'}
          value={code}
          onChange={typed => {
            join.setCode(typed)
            join.setCodeWrong(false)
            join.setError(null)
          }}
          onComplete={typed => void join.check(typed)}
        />
        <ErrorLine error={join.error} />
      </div>
      <Actions onBack={onBack}>
        <Next busy={busy} disabled={code.length !== SIGN_IN_CODE_LENGTH}>
          {t('common.continue')}
        </Next>
      </Actions>
    </form>
  )
}

// An invitation to a household that has no room left.
export const FullStep = ({ onBack }: { onBack: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.form}>
      <StepHeader title={t('join.full.title')} intro={t('join.full.intro')} />
      <Actions onBack={onBack}>{null}</Actions>
    </div>
  )
}

// A young profile's code: "Relier cet appareil" links the device to it.
export const DeviceStep = ({ join, use }: { join: Join; use: Profiled }) => {
  const { t } = useTranslation()
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        void join.link()
      }}
    >
      <StepHeader
        title={t('join.device.title')}
        intro={<RichText i18nKey="join.device.intro" values={{ name: use.profile.name }} />}
      />
      <MemberRow use={use} />
      <ErrorLine error={join.error} />
      <Actions onBack={join.back}>
        <Next busy={join.busy}>{t('join.device.button')}</Next>
      </Actions>
    </form>
  )
}

// The admin's code for an adult who forgot their password: "Nouveau mot de passe".
export const ResetStep = ({ join, use }: { join: Join; use: Profiled }) => {
  const { t } = useTranslation()
  const ready = join.fields.passwordReady
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        if (ready) void join.reset()
      }}
    >
      <StepHeader
        title={t('join.reset.title')}
        intro={<RichText i18nKey="join.reset.intro" values={{ name: use.profile.name }} />}
      />
      <MemberRow use={use} />
      <NewPassword join={join} />
      <ErrorLine error={join.error} />
      <Actions onBack={join.back}>
        <Next busy={join.busy} disabled={!ready}>
          {t('join.reset.button')}
        </Next>
      </Actions>
    </form>
  )
}

type AccountUse = Extract<CodeUse, { kind: 'invite' | 'profile' }>

// The e-mail, then the password of an existing account, or a new one with the age to confirm.
const AccountFields = ({ join }: { join: Join }) => {
  const { t } = useTranslation()
  const { fields } = join
  return (
    <>
      <label className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('setup.account.email')}</span>
        <TextField
          icon={Mail}
          type="email"
          autoComplete="username"
          aria-label={t('setup.account.email')}
          placeholder={t('setup.account.emailPlaceholder')}
          autoFocus
          required
          value={fields.email}
          onChange={event => {
            fields.setEmail(event.target.value)
            join.setError(null)
          }}
        />
      </label>
      {fields.existing ? (
        <div className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('setup.account.password')}</span>
          <PasswordField
            aria-label={t('setup.account.password')}
            autoComplete="current-password"
            required
            value={fields.password}
            onChange={event => {
              fields.setPassword(event.target.value)
              join.setError(null)
            }}
          />
        </div>
      ) : (
        <>
          <NewPassword join={join} />
          <AgeCheckbox checked={fields.age} onChange={fields.setAge} />
        </>
      )}
    </>
  )
}

// A link, as on Connexion: the other way in, under the form.
const ExistingLink = ({ join }: { join: Join }) => {
  const { t } = useTranslation()
  const { fields } = join
  return (
    <div className={loginStyles.links}>
      <a
        href="#"
        className={loginStyles.code}
        onClick={event => {
          event.preventDefault()
          fields.setExisting(value => !value)
          fields.setPassword('')
          fields.setConfirm('')
          join.setError(null)
        }}
      >
        {fields.existing ? <UserPlus size={14} aria-hidden="true" /> : <LogIn size={14} aria-hidden="true" />}
        {fields.existing ? t('join.newAccount') : t('join.existing')}
      </a>
    </div>
  )
}

const accountTexts = (use: AccountUse, existing: boolean, t: TFunction) => {
  if (use.kind === 'profile') {
    return {
      title: t('join.profile.title'),
      intro: t(existing ? 'join.profile.introExisting' : 'join.profile.intro', { household: use.household }),
      button: existing ? t('join.signIn') : t('join.create')
    }
  }
  return {
    title: t('join.invite.title', { household: use.household }),
    intro: use.invitedBy ? t('join.invite.intro', { name: use.invitedBy.name }) : t('join.invite.introNoName'),
    button: t('common.continue')
  }
}

// The person's account: a new one, or « J'ai déjà un compte ». An invitation goes on to "Et toi, c'est qui ?".
export const AccountStep = ({ join, use }: { join: Join; use: AccountUse }) => {
  const { t } = useTranslation()
  const { accountReady, existing } = join.fields
  const total = use.kind === 'invite' ? 2 : 0
  const texts = accountTexts(use, existing, t)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!accountReady) return
    if (use.kind === 'invite') {
      join.setError(null)
      join.setStep('who')
    } else void join.join()
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <StepHeader
        step={total ? 1 : 0}
        total={total}
        title={texts.title}
        intro={texts.intro}
        help={{ id: 'join-account', title: t('setup.account.helpTitle'), body: <p>{t('setup.account.help')}</p> }}
      />
      {use.kind === 'profile' && <MemberRow use={use} />}
      <AccountFields join={join} />
      <ErrorLine error={join.error} />
      <ExistingLink join={join} />
      <Actions onBack={join.back}>
        <Next busy={join.busy} disabled={!accountReady}>
          {texts.button}
        </Next>
      </Actions>
    </form>
  )
}

// An invitation's second step: the new adult's profile.
export const WhoStep = ({ join }: { join: Join }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.form}>
      <StepHeader step={2} total={2} title={t('setup.profile.title')} intro={t('join.who.intro')} />
      <ProfileForm
        className={styles.profileForm}
        submitLabel={
          <>
            {t('join.create')}
            <ArrowRight size={16} aria-hidden="true" />
          </>
        }
        cancelLabel={
          <>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('common.back')}
          </>
        }
        onCancel={() => join.setStep('account')}
        onSave={draft => join.join(draft)}
      />
      <ErrorLine error={join.error} />
    </div>
  )
}
