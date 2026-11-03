import { AlertCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSession } from './api.ts'
import { setHouseholdLanguage, setProfileLanguage } from './lib/i18n.ts'
import { setHourCycle } from './lib/format.ts'
import { usePreferences } from './lib/preferences.ts'
import { startLimits, useLimits, useLimitsReady } from './lib/limits.ts'
import { PROFILE_SWITCHING } from './lib/profiles.ts'
import { useHashRoute } from './lib/use-hash-route.ts'
import Tour from './app/Tour.tsx'
import HomePage from './pages/HomePage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import ProfilePicker from './pages/ProfilePicker.tsx'
import SetupPage from './pages/SetupPage.tsx'
import TimeUpPage from './pages/TimeUpPage.tsx'
import EmptyState from './ui/EmptyState.tsx'
import Button from './ui/Button.tsx'

// setup: a new install, before its first-run screens. choosing: logged in, but no profile picked on this device yet.
type Status = 'loading' | 'setup' | 'anonymous' | 'choosing' | 'authenticated' | 'error'

const App = () => {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status>('loading')
  const route = useHashRoute()
  const { language } = usePreferences()
  const limits = useLimits()
  const limitsReady = useLimitsReady()

  const check = useCallback(() => {
    getSession()
      .then(session => {
        if (session && session !== 'setup') {
          if (session.language) setHouseholdLanguage(session.language)
          setHourCycle(session.hourCycle)
        }
        setStatus(
          session === 'setup' ? 'setup' : !session ? 'anonymous' : session.profileChosen ? 'authenticated' : 'choosing'
        )
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

  // Another profile opens: the page's background until the app has reloaded on it, as when it starts.
  useEffect(() => {
    const switching = () => setStatus('loading')
    window.addEventListener(PROFILE_SWITCHING, switching)
    return () => window.removeEventListener(PROFILE_SWITCHING, switching)
  }, [])

  // The session check is quick: the page's background alone until it answers, no spinner.
  if (status === 'loading') return null

  if (status === 'error') {
    return (
      <EmptyState
        tone="danger"
        icon={<AlertCircle size={28} />}
        title={t('app.unreachableTitle')}
        actions={
          <Button
            look="primary"
            onClick={() => {
              setStatus('loading')
              check()
            }}
            icon={RefreshCw}
          >
            {t('common.retry')}
          </Button>
        }
      >
        {t('app.unreachableText')}
      </EmptyState>
    )
  }

  if (status === 'setup') {
    return <SetupPage onDone={signedIn} />
  }

  if (status === 'anonymous') {
    return <LoginPage onLoggedIn={signedIn} />
  }

  // Its time is up or it is outside its hours: the feed is closed to it.
  const closed = limits !== null && limits.limits.access !== 'open'

  // "Qui lit ?": before anything else on a new device, and from the avatar to switch. From "À demain" there is no
  // way back to the feed, only another profile.
  if (status === 'choosing' || route.name === 'profiles') {
    return (
      <ProfilePicker
        chosen={status === 'authenticated'}
        closed={closed}
        onUnauthorized={() => setStatus('anonymous')}
      />
    )
  }

  // The page's background until the profile's limits are known, as while the session is checked.
  if (!limitsReady) return null

  // "À demain", once the article it reads is closed.
  if (limits && closed && route.name !== 'article') {
    return <TimeUpPage limits={limits.limits} />
  }

  return (
    <>
      <HomePage onLoggedOut={() => setStatus('anonymous')} />
      <Tour />
    </>
  )
}

export default App
