import type { PluginTranslations } from './plugin-texts.ts'

// A plugin of Hodi's plugin registry (server/plugins/catalog.ts), as Serveur › Plugins lists it.
export interface CatalogPlugin {
  id: string
  name: string
  description: string
  translations: PluginTranslations
  version: string
  repo: string
}

// « 1.10.0 » comes after « 1.9.2 »: numbers compare one by one, a missing one counts as 0.
export const newerVersion = (candidate: string, current: string) => {
  const parts = (version: string) => (version.split('-')[0] ?? '').split('.').map(Number)
  const [a, b] = [parts(candidate), parts(current)]
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const [x, y] = [a[index] ?? 0, b[index] ?? 0]
    if (x !== y) return x > y
  }
  return false
}

interface Installed {
  id: string
  version: string | null
  dev?: boolean
}

// The registry's plugins the server does not have yet.
export const availableOf = (catalog: CatalogPlugin[], installed: Installed[]) =>
  catalog.filter(plugin => !installed.some(own => own.id === plugin.id))

// The registry's newer version of an installed plugin, or null. A plugin in development is the author's own build.
export const updateOf = (catalog: CatalogPlugin[], plugin: Installed) => {
  const listed = catalog.find(entry => entry.id === plugin.id)
  if (!listed || plugin.dev || !plugin.version) return null
  return newerVersion(listed.version, plugin.version) ? listed.version : null
}
