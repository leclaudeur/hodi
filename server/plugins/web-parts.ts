import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

// What a plugin brings to the web app, read from its folder: the browser asks for these files only.
export interface WebParts {
  // web.js: a script the app runs once signed in (see web/src/plugins/).
  script: boolean
  // web.css: its styles.
  style: boolean
  // web-public.js and web-public.css: what it draws before a profile is open (Connexion, « Qui lit ? »), the only
  // part a visitor may download. Once signed in, the app loads it before web.js.
  publicScript: boolean
  publicStyle: boolean
  // The languages of locales/<language>.json.
  locales: string[]
}

export const NO_WEB: WebParts = { script: false, style: false, publicScript: false, publicStyle: false, locales: [] }

export const localesOf = (root: string) => {
  const locales = path.join(root, 'locales')
  return existsSync(locales)
    ? readdirSync(locales)
        .map(name => /^([a-z]{2})\.json$/.exec(name)?.[1])
        .filter((language): language is string => Boolean(language))
        .sort()
    : []
}

export const webParts = (root: string): WebParts => ({
  script: existsSync(path.join(root, 'web.js')),
  style: existsSync(path.join(root, 'web.css')),
  publicScript: existsSync(path.join(root, 'web-public.js')),
  publicStyle: existsSync(path.join(root, 'web-public.css')),
  locales: localesOf(root)
})

// An unsigned plugin's code never reaches the page, but its texts do: they are data, and the server admin's page names
// its options with them rather than with their raw keys.
export const textsOnly = (root: string): WebParts => ({ ...NO_WEB, locales: localesOf(root) })
