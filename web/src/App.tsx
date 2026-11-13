import { AlertCircle, RefreshCw } from 'lucide-react'
import { type ComponentProps, Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROFILE_CLOSED, getSession, leaveProfile } from './api.ts'
import { isLinkedDevice, setLinkedDevice } from './lib/linked-device.ts'
import { setServerOnly } from './lib/server-only.ts'
import { setHouseholdLanguage, setProfileLanguage } from './lib/i18n.ts'
import { setContentDays } from './lib/content-days.ts'
import { setNoPassword, setTwoFactorOn } from './lib/two-factor.ts'
import { setHourCycle } from './lib/format.ts'
import { usePreferences } from './lib/preferences.ts'
import { startLimits, useLimits, useLimitsReady } from './lib/limits.ts'
import { PROFILE_SWITCHING } from './lib/profiles.ts'
import { anotherTabOpen, answerOtherTabs } from './lib/other-tabs.ts'
import { useHashRoute } from './lib/use-hash-route.ts'
import { loadedPlugins, loadPlugins, loadPublicPlugins, usePluginSlots, usePlugins } from './plugins/registry.ts'
import PluginSlot from './plugins/PluginSlot.tsx'
import { useScreenLayout } from './plugins/Slots.tsx'
import { clearSignedIn, isJustSignedIn } from './lib/after-sign-in.ts'
import SignedOut from './app/SignedOut.tsx'
import Tour from './app/Tour.tsx'
import HomePage from './pages/HomePage.tsx'
import ProfilePicker from './pages/ProfilePicker.tsx'
import TimeUpPage from './pages/TimeUpPage.tsx'
import EmptyState from './ui/EmptyState.tsx'
import Button from './ui/Button.tsx'
import LoadingScreen from './ui/LoadingScreen.tsx'

// Screens most people never open: the first-run setup and the server's space, with its charts. They come in files of
// their own, so the app every reader downloads first stays small.
const LazyServerSpace = lazy(() => import('./views/server/ServerSpace.tsx'))
const LazySetupPage = lazy(() => import('./pages/SetupPage/SetupPage.tsx'))

const ServerSpace = (props: ComponentProps<typeof LazyServerSpace>) => (
  <Suspense fallback={<LoadingScreen />}>
    <LazyServerSpace {...props} />
  </Suspense>
)

const SetupPage = (props: ComponentProps<typeof LazySetupPage>) => (
  <Suspense fallback={<LoadingScreen />}>
    <LazySetupPage {...props} />
  </Suspense>
)

// setup: a new install, before its first-run screens. choosing: logged in, but no profile picked on this device yet.
// server: the server's admin with no household yet, in /server alone.
type Status = 'loading' | 'setup' | 'anonymous' | 'choosing' | 'authenticated' | 'server' | 'error'

// Each time the app opens (not on a reload in the same tab), it starts on « Qui lit ? », as Netflix does: the device
// may be shared, and the profile open when it closed may not be the reader's. Not while another tab of Hodi is open in
// this browser: they share the profile cookie, so closing it here would close it under that tab's feet.
const OPENED_KEY = 'hodi:opened'
// true: the profile was closed, so the session preload.js asked for as the page loaded no longer holds.
const leaveOnOpen = async () => {
  answerOtherTabs()
  try {
    if (sessionStorage.getItem(OPENED_KEY)) return false
    sessionStorage.setItem(OPENED_KEY, '1')
  } catch {
    return false
  }
  if (await anotherTabOpen()) return false
  await leaveProfile().catch(() => {})
  return true
}

// Lets the person in at once when a plugin's step after sign-in breaks.
const AfterSignInFailed = ({ done }: { done: () => void }) => {
  useEffect(done, [done])
  return null
}

type Session = Awaited<ReturnType<typeof getSession>>

const statusOf = (session: Session): Status => {
  if (session === 'setup') return 'setup'
  if (!session) return 'anonymous'
  if (session.serverOnly) return 'server'
  return session.profileChosen ? 'authenticated' : 'choosing'
}

// The household's and the device's settings that every screen reads.
const applySession = (session: Session) => {
  if (!session || session === 'setup') return
  if (session.language) setHouseholdLanguage(session.language)
  setLinkedDevice(session.linkedDevice)
  setServerOnly(session.serverOnly)
  setHourCycle(session.hourCycle)
  if (session.content) setContentDays(session.content)
  setTwoFactorOn(session.twoFactor)
  setNoPassword(session.noPassword)
}

// The household's plugins, in the background: the first screen never waits for them. Before a profile is open, only
// the ones that draw on Connexion and « Qui lit ? ». Signed out after the signed-in ones loaded: the app starts
// again, so that none of them stays in the page.
const usePluginLoading = (status: Status) => {
  useEffect(() => {
    if (status === 'authenticated' || status === 'server') void loadPlugins()
    else if (status === 'choosing') void loadPublicPlugins()
    else if (status === 'anonymous') {
      if (loadedPlugins() === 'signedIn') window.location.reload()
      else void loadPublicPlugins()
    }
  }, [status])
}

// The session's events from elsewhere in the page.
const useSessionEvents = (check: () => void, setStatus: (status: Status) => void) => {
  // The server says this device's profile is closed (another browser window closed it, or its password changed):
  // « Qui lit ? » at once, rather than screens whose every request fails.
  useEffect(() => {
    window.addEventListener(PROFILE_CLOSED, check)
    return () => window.removeEventListener(PROFILE_CLOSED, check)
  }, [check])

  // Another profile opens: the loading screen until the app has reloaded on it, as when it starts.
  useEffect(() => {
    const switching = () => setStatus('loading')
    window.addEventListener(PROFILE_SWITCHING, switching)
    return () => window.removeEventListener(PROFILE_SWITCHING, switching)
  }, [setStatus])
}

// A plugin's step just after sign-in (« Quel foyer ? »), before « Qui lit ? » or the app: null when there is none to
// take, 'wait' until the plugins are known.
const useAfterSignIn = (status: Status) => {
  const plugins = usePlugins()
  const [afterSignIn] = usePluginSlots('afterSignIn')
  const [justSignedIn, setJustSignedIn] = useState(isJustSignedIn)
  const layout = useScreenLayout()
  // The server's admin with no household has no step to take (/server alone), nor does anyone when no plugin has one.
  const noStep = status === 'server' || (plugins.ready && !afterSignIn)
  useEffect(() => {
    if (justSignedIn && noStep) clearSignedIn()
  }, [justSignedIn, noStep])
  if (!justSignedIn || noStep || (status !== 'choosing' && status !== 'authenticated')) return null
  // The loading screen until the plugins are known.
  if (!plugins.ready || !afterSignIn) return 'wait'
  const done = () => {
    clearSignedIn()
    setJustSignedIn(false)
  }
  return (
    <PluginSlot
      id={afterSignIn.id}
      component={afterSignIn.value}
      props={{ layout, done }}
      // A step that breaks never keeps the person out.
      fallback={<AfterSignInFailed done={done} />}
    />
  )
}

const Unreachable = ({ retry }: { retry: () => void }) => {
  const { t } = useTranslation()
  return (
    <EmptyState
      tone="danger"
      icon={<AlertCircle size={28} />}
      title={t('app.unreachableTitle')}
      actions={
        <Button look="primary" onClick={retry} icon={RefreshCw}>
          {t('common.retry')}
        </Button>
      }
    >
      {t('app.unreachableText')}
    </EmptyState>
  )
}

// The app once a profile is open, or « Qui lit ? » to open one.
const SignedIn = ({ status, setStatus }: { status: Status; setStatus: (status: Status) => void }) => {
  const route = useHashRoute()
  const limits = useLimits()
  const limitsReady = useLimitsReady()
  // Its time is up or it is outside its hours: the feed is closed to it.
  const closed = limits !== null && limits.limits.access !== 'open'

  // "Qui lit ?": before anything else on a new device, and from the avatar to switch. From "À demain" there is no
  // way back to the feed, only another profile.
  // A young profile's own device has no other profile to open.
  if (status === 'choosing' || (route.name === 'profiles' && !isLinkedDevice())) {
    return (
      <ProfilePicker
        chosen={status === 'authenticated'}
        closed={closed}
        onUnauthorized={() => setStatus('anonymous')}
      />
    )
  }

  // The loading screen until the profile's limits are known, as while the session is checked.
  if (!limitsReady) return <LoadingScreen />

  // "À demain", once the article it reads is closed.
  if (limits && closed && route.name !== 'article') {
    return <TimeUpPage limits={limits.limits} />
  }

  // The server's admin space: its own layout, none of the app's.
  if (route.name === 'server')
    return <ServerSpace section={route.section} item={route.item} pluginSection={route.plugin} />

  return (
    <>
      <HomePage onLoggedOut={() => setStatus('anonymous')} />
      <Tour />
    </>
  )
}

const App = () => {
  const [status, setStatus] = useState<Status>('loading')
  const route = useHashRoute()
  const { language } = usePreferences()

  const check = useCallback(() => {
    leaveOnOpen()
      .then(left => getSession(left))
      .then(session => {
        applySession(session)
        setStatus(statusOf(session))
      })
      .catch(() => setStatus('error'))
  }, [])

  useEffect(check, [check])

  // Signed in (or the household just set up): the app starts again on the new session. This page's preload.js asked
  // for the first requests before there was one, and the browser would hand the app those refused answers.
  const signedIn = useCallback(() => {
    setStatus('loading')
    window.location.reload()
  }, [])

  // The profile's own language, once its settings are in; until then (and without one) the household's.
  useEffect(() => {
    setProfileLanguage(status === 'authenticated' ? language : null)
  }, [status, language])

  // A young profile reads within its parents' time and hours.
  useEffect(() => {
    if (status === 'authenticated') startLimits()
  }, [status])

  usePluginLoading(status)
  const step = useAfterSignIn(status)
  useSessionEvents(check, setStatus)

  // The loading screen until the session answers (it stays empty for a quick answer).
  if (status === 'loading') return <LoadingScreen />
  if (status === 'error') {
    return (
      <Unreachable
        retry={() => {
          setStatus('loading')
          check()
        }}
      />
    )
  }
  if (status === 'setup') return <SetupPage onDone={signedIn} />
  if (status === 'anonymous') return <SignedOut onLoggedIn={signedIn} />

  // No household yet: the server's space whatever the address, with its plugins' sections.
  if (status === 'server') {
    return route.name === 'server' ? (
      <ServerSpace section={route.section} item={route.item} pluginSection={route.plugin} />
    ) : (
      <ServerSpace section={null} />
    )
  }

  if (step === 'wait') return <LoadingScreen />
  if (step) return step
  return <SignedIn status={status} setStatus={setStatus} />
}

export default App
