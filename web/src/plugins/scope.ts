import { createContext, useContext } from 'react'

// The plugin whose components are drawing: Hodi wraps each plugin's slot in it, so the SDK's hooks know whose texts
// and routes to use without the plugin naming itself.
export const PluginScope = createContext<string | null>(null)

export const usePluginId = () => {
  const id = useContext(PluginScope)
  if (!id) throw new Error('A plugin hook was called outside a plugin slot')
  return id
}
