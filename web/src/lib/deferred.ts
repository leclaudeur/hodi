// Code no screen needs to show first: each comes in its own file, asked for once the app has shown, so it is ready
// (and kept by the service worker for offline use) before the person opens an article, shares or sees a toast.
// main.tsx adds the screens' own, such as the settings, which the plugins' SDK must not reach.

export const loadSanitizer = () => import('./sanitize.ts')
export const loadShareOptions = () => import('../views/reader/ShareOptions.tsx')
export const loadToaster = () => import('../ui/SonnerToaster.tsx')
export const loadSonner = () => import('sonner')

// A few seconds after the page loaded, when the browser has nothing else to do.
const WARM_DELAY_MS = 3000

export const warmDeferred = (screens: (() => Promise<unknown>)[] = []) => {
  const warm = () =>
    [loadSanitizer, loadShareOptions, loadToaster, loadSonner, ...screens].forEach(load => void load().catch(() => {}))
  // Safari has no requestIdleCallback.
  const idle = (run: () => void) =>
    typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(run) : setTimeout(run, 0)
  const start = () => window.setTimeout(() => idle(warm), WARM_DELAY_MS)
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}
