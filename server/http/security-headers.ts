import type { RequestHandler } from 'express'

// The only <style> elements the app adds itself, by their hash (server/test/security-headers.test.ts checks them
// against the installed libraries): sonner's toast styles, appended empty then filled, and the scrollbar probe
// OverlayScrollbars measures the browser with.
export const STYLE_HASHES = [
  // An empty <style>.
  'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
  // sonner 2.0.8
  'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY=',
  // overlayscrollbars 2.17.0
  'sha256-sZSZaxZAOXHO56vYIM2MMQWIEd/XqOqh0WWFgLY9NmI='
]

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // The YouTube player's API, which the video controls drive.
  "script-src 'self' https://www.youtube.com",
  `style-src 'self' ${STYLE_HASHES.map(hash => `'${hash}'`).join(' ')}`,
  // Feed and article images come from the news sites themselves.
  "img-src 'self' data: https:",
  "connect-src 'self'",
  // YouTube videos play in its privacy-enhanced player; podcasts stream from their hosts.
  'frame-src https://www.youtube-nocookie.com',
  // Podcasts stream from their hosts.
  "media-src 'self' https:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ')

export const securityHeaders: RequestHandler = (_request, response, next) => {
  response.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // Article links open on third-party sites; do not leak the app URL to them.
    'Referrer-Policy': 'no-referrer',
    // A personal install: keep it out of search engines.
    'X-Robots-Tag': 'noindex, nofollow'
  })

  next()
}
