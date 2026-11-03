// Hodi service worker: makes the app installable and keeps what was opened readable offline.
// Everything it keeps stays on this device, and the data cache is emptied on logout.
const SHELL_CACHE = 'hodi-shell-v1'
// Same name as DATA_CACHE in src/api.ts.
const DATA_CACHE = 'hodi-data-v1'
const MAX_ARTICLES = 200

// API routes worth showing offline: the session check, the profiles and the game (the avatars), topic lists, the
// front page and opened articles.
const OFFLINE_ROUTES = [
  /^\/api\/session$/,
  /^\/api\/profiles$/,
  /^\/api\/game$/,
  /^\/api\/topics(\/|$)/,
  /^\/api\/articles\//,
  /^\/api\/front-page$/,
  /^\/api\/feed$/,
  /^\/api\/listen$/
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(['/', '/theme.js'])))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key !== SHELL_CACHE && key !== DATA_CACHE).map(key => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  )
})

// Keeps the most recently opened articles and days of "Le fil" only.
const MAX_DAYS = 40
const trimArticles = async cache => {
  const keys = await cache.keys()
  const trim = (prefix, max) => {
    const matching = keys.filter(request => new URL(request.url).pathname.startsWith(prefix))
    return matching.slice(0, Math.max(0, matching.length - max)).map(request => cache.delete(request))
  }
  await Promise.all([...trim('/api/articles/', MAX_ARTICLES), ...trim('/api/feed', MAX_DAYS)])
}

// Fresh from the network when online, the last saved copy otherwise: also when the server can't answer
// (5xx: the home server or its tunnel down, the network up).
const networkFirst = async (request, cacheName, cacheKey = request) => {
  const cache = await caches.open(cacheName)

  try {
    const response = await fetch(request)

    if (response.ok) {
      await cache.delete(cacheKey)
      await cache.put(cacheKey, response.clone())
      if (cacheName === DATA_CACHE) await trimArticles(cache)
    } else if (response.status >= 500) {
      return (await cache.match(cacheKey)) ?? response
    }

    return response
  } catch (error) {
    const cached = await cache.match(cacheKey)
    if (cached) return cached
    throw error
  }
}

// Bundles have a hash in their name: a saved copy never goes stale.
const cacheFirst = async request => {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Every page is the same app: one saved copy of it serves them all.
    event.respondWith(networkFirst(request, SHELL_CACHE, '/'))
  } else if (url.pathname === '/theme.js') {
    event.respondWith(networkFirst(request, SHELL_CACHE))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
  } else if (OFFLINE_ROUTES.some(route => route.test(url.pathname))) {
    event.respondWith(networkFirst(request, DATA_CACHE))
  }
})

// Notifications for followed subjects, shares and reactions to them, sent by the server (see server/news/followed-alerts.ts).
self.addEventListener('push', event => {
  let alert
  try {
    alert = event.data.json()
  } catch {
    return
  }

  const shown = self.registration.showNotification(alert.title, {
    body: alert.body,
    tag: alert.tag,
    icon: '/icon-192.png',
    data: { url: alert.url }
  })
  const badge =
    typeof alert.badge === 'number' && 'setAppBadge' in navigator ? navigator.setAppBadge(alert.badge) : null

  event.waitUntil(Promise.all([shown, badge]).catch(() => {}))
})

// Opens the article, the video (or "Suivis") in the app, reusing its window when it is open.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL(`/${event.notification.data?.url ?? ''}`, self.location.origin).href
  // A followed subject's article, opened from its notification: it counts for the household game's badge.
  const article = /^#\/article\/(.+)$/.exec(event.notification.data?.url ?? '')
  const counted =
    event.notification.tag.startsWith('followed:') && article
      ? fetch('/api/me/game/alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId: decodeURIComponent(article[1]) })
        }).catch(() => {})
      : Promise.resolve()

  event.waitUntil(
    Promise.all([
      counted,
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
        const open = windows.find(client => new URL(client.url).origin === self.location.origin)
        return open ? open.focus().then(client => client.navigate(url)) : self.clients.openWindow(url)
      })
    ])
  )
})
