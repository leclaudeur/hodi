import path from 'node:path'
import type express from 'express'
import type { LoadedPlugin } from '../plugins/registry.ts'

// Only what runs in the browser: web.js, web.css, web-public.js, web-public.css, locales/ and assets/. Never server.js
// nor plugin.json.
export const LOCALE_FILE = /^locales\/[a-z]{2}\.json$/
export const WEB_FILE =
  /^(web(?:-public)?\.js|web(?:-public)?\.css|locales\/[a-z]{2}\.json|assets\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*)$/

// A plugin's page among its assets (a demo, a preview) can show in a frame of Hodi's page, and only there. The
// browser runs it sandboxed, in an origin of its own: it never reads Hodi's cookies, storage or page, and Hodi's page
// only talks to it with postMessage. Its own files load from this server; it calls no address, opens no window and
// loads no image from elsewhere (the page may be on a public landing: no beacon). Every kind of file a browser shows
// as a document gets it, whatever the case of its extension.
export const PLUGIN_PAGE = /^assets\/.+\.(?:html?|xhtml|svg)$/i
export const PLUGIN_PAGE_POLICY = [
  'sandbox allow-scripts',
  "default-src 'self'",
  "script-src 'self'",
  // A page drawn from markup with its own style attributes (as Hodi's components write them): harmless in a sandbox.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'"
].join('; ')

export const sendWebFile = (plugin: LoadedPlugin, file: string, response: express.Response) => {
  response.set('Cache-Control', 'no-cache')
  if (PLUGIN_PAGE.test(file))
    response.set({ 'Content-Security-Policy': PLUGIN_PAGE_POLICY, 'X-Frame-Options': 'SAMEORIGIN' })
  response.sendFile(path.join(plugin.dir, file), { dotfiles: 'deny' }, error => {
    if (error && !response.headersSent) response.status(404).json({ error: 'not_found' })
  })
}
