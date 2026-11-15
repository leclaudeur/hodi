import {
  type OverviewCardSlot,
  type PluginInfo,
  SERVER_SECTION_ID,
  type ServerSection,
  type SetupStep,
  type WebPlugin
} from './registry.ts'

// Where plugins' own pages go in the list of Réglages. A plugin's manifest names a group and, optionally, the entry
// it comes after; an unknown group or entry puts it at the end of the household's group.

export interface MenuPlugin {
  id: string
  group: string
  after?: string
}

// The plugins with a page to list: on, loaded, and whose web part gave a page.
export const menuPlugins = (plugins: readonly PluginInfo[], web: ReadonlyMap<string, WebPlugin>): MenuPlugin[] =>
  plugins
    .filter(plugin => plugin.enabled && !plugin.error && plugin.menu && web.get(plugin.id)?.page)
    .map(plugin => ({
      id: plugin.id,
      group: plugin.menu!.group,
      ...(plugin.menu!.after ? { after: plugin.menu!.after } : {})
    }))

export const FALLBACK_GROUP = 'household'

// Puts each plugin's entry in its group, after the entry it names (or after the plugins already placed there), else
// at the group's end. Groups and entries keep their order; plugins keep theirs among themselves.
export const placePlugins = <Entry extends { id: string }, Group extends { id: string; entries: Entry[] }>(
  groups: readonly Group[],
  plugins: readonly MenuPlugin[],
  entryOf: (plugin: MenuPlugin) => Entry
): Group[] => {
  const known = new Set(groups.map(group => group.id))
  return groups.map(group => {
    const mine = plugins.filter(plugin => (known.has(plugin.group) ? plugin.group : FALLBACK_GROUP) === group.id)
    if (mine.length === 0) return group
    const entries = [...group.entries]
    const placed = new Set<string>()
    for (const plugin of mine) {
      const entry = entryOf(plugin)
      const anchor = plugin.after ? entries.findIndex(other => other.id === plugin.after) : -1
      if (anchor === -1) entries.push(entry)
      else {
        // After the named entry and the plugins already put after it.
        let at = anchor + 1
        while (at < entries.length && placed.has(entries[at]?.id ?? '')) at++
        entries.splice(at, 0, entry)
      }
      placed.add(entry.id)
    }
    return { ...group, entries }
  })
}

// The plugins' groups of the server's sidebar, under Hodi's own: each active plugin whose web part gave sections, in
// the plugins' order, with its sections in its own. A section whose id is not valid, or that comes twice, is left out.
export const serverPluginGroups = (
  plugins: readonly PluginInfo[],
  web: ReadonlyMap<string, WebPlugin>
): { plugin: PluginInfo; sections: ServerSection[] }[] =>
  plugins
    .filter(plugin => plugin.enabled && !plugin.error)
    .map(plugin => {
      const seen = new Set<string>()
      const sections = (web.get(plugin.id)?.serverSections ?? []).filter(section => {
        if (!SERVER_SECTION_ID.test(section.id) || seen.has(section.id) || typeof section.page !== 'function')
          return false
        seen.add(section.id)
        return true
      })
      return { plugin, sections }
    })
    .filter(group => group.sections.length > 0)

const CARD_SIZES = new Set(['narrow', 'wide', 'full'])

// The plugins' cards on Serveur › Vue d'ensemble, one plugin after the other in the plugins' order, each plugin's in
// its own. A card whose id is not valid or comes twice in its plugin, whose size is not known or that has no
// component is left out.
export const overviewPluginCards = (
  plugins: readonly PluginInfo[],
  web: ReadonlyMap<string, WebPlugin>
): { plugin: PluginInfo; card: OverviewCardSlot }[] =>
  plugins
    .filter(plugin => plugin.enabled && !plugin.error)
    .flatMap(plugin => {
      const seen = new Set<string>()
      return (web.get(plugin.id)?.overviewCards ?? [])
        .filter(card => {
          const usable =
            SERVER_SECTION_ID.test(card.id) &&
            !seen.has(card.id) &&
            CARD_SIZES.has(card.size) &&
            typeof card.component === 'function'
          if (usable) seen.add(card.id)
          return usable
        })
        .map(card => ({ plugin, card }))
    })

// The plugins' steps in the setup, one plugin after the other in the plugins' order: only the plugins on, loaded and
// signed (an unsigned plugin has no web part). A step whose id is not valid or comes twice in its plugin, with no page
// and no known core step, or without its title and line, is left out.
export const setupPluginSteps = (
  plugins: readonly PluginInfo[],
  web: ReadonlyMap<string, WebPlugin>
): { plugin: PluginInfo; step: SetupStep }[] =>
  plugins
    .filter(plugin => plugin.enabled && (plugin.signed || plugin.dev) && !plugin.error)
    .flatMap(plugin => {
      const seen = new Set<string>()
      return (web.get(plugin.id)?.setupSteps ?? [])
        .filter(step => {
          if (!SERVER_SECTION_ID.test(step.id) || seen.has(step.id)) return false
          const usable =
            'core' in step
              ? step.core === 'mail'
              : typeof step.page === 'function' && typeof step.title === 'string' && typeof step.intro === 'string'
          if (usable) seen.add(step.id)
          return usable
        })
        .map(step => ({ plugin, step }))
    })
