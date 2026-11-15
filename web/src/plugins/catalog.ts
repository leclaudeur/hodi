import gt from 'semver/functions/gt'
import valid from 'semver/functions/valid'
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

// « 1.10.0 » comes after « 1.9.2 », and « 1.0.0 » after « 1.0.0-beta.2 »: semver's order. A version semver cannot
// read is never newer.
export const newerVersion = (candidate: string, current: string) => {
  const [a, b] = [valid(candidate), valid(current)]
  return a != null && b != null && gt(a, b)
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
