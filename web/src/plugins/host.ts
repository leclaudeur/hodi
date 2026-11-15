import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as sdk from './sdk.ts'

// The modules a plugin's web.js leaves out of its bundle and takes from Hodi: one React for the whole page, and the
// SDK. A plugin is built as a script whose imports read these (react → __hodi.react, hodi:sdk → __hodi.sdk), since
// the CSP lets the page run its own scripts only, not an import map.

// Bumped with the plugin API's major version (server/plugins/manifest.ts).
const PLUGIN_API = 2

declare global {
  interface Window {
    __hodi?: {
      api: number
      react: typeof React
      jsxRuntime: typeof jsxRuntime
      reactDom: typeof ReactDOM
      sdk: typeof sdk
    }
  }
}

window.__hodi = { api: PLUGIN_API, react: React, jsxRuntime, reactDom: ReactDOM, sdk }
