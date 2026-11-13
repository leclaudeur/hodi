import { useEffect, useState } from 'react'

// What Serveur › Contenu and Sauvegardes promise (the same as a plugin's ctx.serverSettings()): read on any page, signed
// in or not, once per page load.
export interface ServerSettings {
  articleDays: number
  videoDays: number
  textDays: number
  backupCopies: number
  // How many sources a household may follow; null: no limit.
  maxSources: number | null
}

let loading: Promise<ServerSettings | null> | null = null

const load = () => {
  loading ??= fetch('/api/server-settings')
    .then(response => (response.ok ? (response.json() as Promise<ServerSettings>) : null))
    .catch(() => null)
    .then(settings => {
      // A failure is asked again next time, rather than kept.
      if (!settings) loading = null
      return settings
    })
  return loading
}

// Read only. null until the server answered, or when it cannot be reached.
export const useServerSettings = () => {
  const [settings, setSettings] = useState<ServerSettings | null>(null)
  useEffect(() => {
    let current = true
    void load().then(loaded => {
      if (current) setSettings(loaded)
    })
    return () => {
      current = false
    }
  }, [])
  return settings
}
