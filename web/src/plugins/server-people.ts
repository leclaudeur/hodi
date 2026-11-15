import { useEffect, useState } from 'react'
import { getServerAccounts, getServerHouseholds } from '../api.ts'

// What Serveur › Foyers and Comptes show the server's admin, for a plugin's cards and pages in the server's space: who
// is on the server and how recently, never an e-mail address nor anything anyone reads.
export interface ServerHouseholdSummary {
  id: number
  name: string
  createdAt: number
  adults: number
  young: number
}

export interface ServerAccountSummary {
  id: number
  householdId: number | null
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

const readHouseholds = async (): Promise<ServerHouseholdSummary[]> =>
  (await getServerHouseholds()).households.map(({ id, name, createdAt, adults, young }) => ({
    id,
    name,
    createdAt,
    adults,
    young
  }))

const readAccounts = async (): Promise<ServerAccountSummary[]> =>
  (await getServerAccounts()).map(({ id, household, createdAt, lastSeenAt }) => ({
    id,
    householdId: household?.id ?? null,
    createdAt,
    lastSeenAt
  }))

export const useServerHouseholds = () => useRead(readHouseholds)
export const useServerAccounts = () => useRead(readAccounts)
