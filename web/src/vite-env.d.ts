/// <reference types="vite/client" />

// The version of package.json, set by vite.config.ts.
declare const __APP_VERSION__: string

declare module 'virtual:hodi-config' {
  const config: import('../../shared/config-schema.ts').Config
  export default config
}
