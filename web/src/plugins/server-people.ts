import { useEffect, useState } from 'react'
import { getServerAccounts } from '../api.ts'

// What Serveur › Comptes shows the server's admin, for a plugin's cards and pages in the server's space: who is on the
// server and how recently, never an e-mail address nor anything anyone reads.
export interface ServerAccountSummary {
  id: number
  createdAt: number
  // When one of its devices last opened Hodi; null: never.
  lastSeenAt: number | null
}

// Read once each time the component is drawn. null until the server answered, and for anyone but the server's admin.
const useRead = <T>(read: () => Promise<T>) => {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let current = true
    read()
      .then(next => current && setValue(next))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [read])
  return value
}

const readAccounts = async (): Promise<ServerAccountSummary[]> =>
  (await getServerAccounts()).map(({ id, createdAt, lastSeenAt }) => ({ id, createdAt, lastSeenAt }))

export const useServerAccounts = () => useRead(readAccounts)
