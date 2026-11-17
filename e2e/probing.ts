import type { Browser, BrowserContext, Response } from '@playwright/test'

// CrowdSec's crowdsecurity/http-probing, as a public server's proxy runs it: per address, each 400, 403 or 404 on a
// path that is not a static file goes in a bucket that holds each path once, leaks one every 10 s, and bans past 10.
// Every device of the tests shares one address, as a household behind one box does.
const REFUSALS = new Set([400, 403, 404])
const LEAK_MS = 10_000
// Half of CrowdSec's capacity: a journey that comes near a ban fails long before one.
export const MAX_PROBING = 5

// A file the proxy's parser counts as static: an extension, as /assets/index.js or /favicon.ico.
const isStatic = (pathname: string) => /\.[a-z0-9]{1,5}$/i.test(pathname)

export interface Refusal {
  status: number
  method: string
  path: string
}

export const probingWatch = () => {
  let origin = ''
  let bucket: string[] = []
  let lastLeak = 0
  let peak = 0
  let refusals: Refusal[] = []

  const add = (path: string, at: number) => {
    const leaked = Math.floor((at - lastLeak) / LEAK_MS)
    if (leaked > 0) {
      bucket = bucket.slice(leaked)
      lastLeak += leaked * LEAK_MS
    }
    if (bucket.length === 0) lastLeak = at
    if (!bucket.includes(path)) bucket.push(path)
    peak = Math.max(peak, bucket.length)
  }

  const seen = (response: Response) => {
    const url = new URL(response.url())
    if (url.origin !== origin || isStatic(url.pathname) || !REFUSALS.has(response.status())) return
    const path = `${url.pathname}${url.search}`
    refusals.push({ status: response.status(), method: response.request().method(), path })
    add(path, Date.now())
  }

  const watch = (context: BrowserContext) => context.on('response', seen)

  return {
    // Every page and context the tests open from now on, the service worker's requests included.
    attach: (browser: Browser, baseURL: string) => {
      origin = new URL(baseURL).origin
      const newContext = browser.newContext.bind(browser)
      const newPage = browser.newPage.bind(browser)
      browser.newContext = async options => {
        const context = await newContext(options)
        watch(context)
        return context
      }
      browser.newPage = async options => {
        const page = await newPage(options)
        watch(page.context())
        return page
      }
    },
    // What the last journey got refused, and the fullest the bucket has been since the tests began.
    take: () => {
      const taken = { refusals, peak }
      refusals = []
      return taken
    }
  }
}
