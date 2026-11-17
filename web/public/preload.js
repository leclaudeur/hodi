// The requests every start of the app makes, sent while its code is still downloading: on a phone's network the code
// takes a second or more, and the app then finds the answers already there instead of asking only then. The app's
// fetch() takes a preloaded answer when the address is the same, so these follow src/api.ts and src/lib/user-state.ts.
// Only the session for a browser that had none the last time (src/lib/session-hint.ts): a visitor would get every other
// request refused.
try {
  var urls = ['/api/session']
  if (localStorage.getItem('hodi:had-session') === '1') preloadSignedIn(urls)
  urls.forEach(function (url) {
    var link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'fetch'
    link.crossOrigin = 'anonymous'
    link.href = url
    document.head.appendChild(link)
  })
} catch {
  // Storage blocked: the app asks itself, as before.
}

// The profile's own data only when this tab had one open (src/lib/session-hint.ts): a new tab starts on « Qui lit ? »,
// where a profile that asks for its password would refuse each request, and a burst of refusals reads as probing to a
// proxy such as CrowdSec, which bans the address.
function preloadSignedIn(urls) {
  urls.push('/api/profiles')
  if (sessionStorage.getItem('hodi:profile-open') !== '1') return
  urls.push('/api/me/limits', '/api/game', '/api/topics')
  var state = JSON.parse(localStorage.getItem('hodi:user-state') || 'null')
  urls.push('/api/me?since=' + ((state && state.revision) || 0))
  // The home page, and the pages shown over it (a story, the daily summary): the day's articles, "À la une" and the
  // daily summary at its head, and "Reprendre" above them.
  if (/^(#\/?)?$|^#\/(une\/|resume$)/.test(location.hash)) {
    var timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    urls.push(
      '/api/feed?' + new URLSearchParams({ tz: timeZone }),
      '/api/front-page',
      '/api/daily-summary',
      '/api/me/resume'
    )
  }
  // An article opened from a link or reloaded: its text, as the reader asks for it.
  var article = /^#\/article\/([\w-]{16})$/.exec(location.hash)
  if (article) urls.push('/api/articles/' + article[1])
}
