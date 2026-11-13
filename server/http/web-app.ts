import path from 'node:path'
import express, { type ErrorRequestHandler } from 'express'
import expressStaticGzip from 'express-static-gzip'

// The PWA's files, and index.html for every client-side route.
export const serveWebApp = (app: express.Express, webDir: string) => {
  // The web bundle holds no data: it is public so the login page can load.
  // Its scripts and styles were compressed once at build time, at brotli's highest level (vite.config.ts): smaller
  // than compressing them on each request, and no work for the server.
  app.use(
    '/assets',
    expressStaticGzip(path.join(webDir, 'assets'), {
      enableBrotli: true,
      orderPreference: ['br'],
      index: false,
      serveStatic: { immutable: true, maxAge: '1y', fallthrough: false }
    })
  )
  app.use(express.static(webDir, { index: false }))

  // Single-page app fallback for client-side routes.
  app.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next()
      return
    }

    response.set('Cache-Control', 'no-cache')
    response.sendFile(path.join(webDir, 'index.html'))
  })
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const status = typeof error?.status === 'number' && error.status < 500 ? error.status : 500

  if (status === 500) {
    console.error(error)
  }

  const code = status === 500 ? 'internal_error' : status === 404 ? 'not_found' : 'bad_request'

  response.status(status).json({ error: code })
}
