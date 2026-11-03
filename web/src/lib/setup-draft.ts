import type { ProfileColor } from '../api.ts'

// The setup screens' answers, kept on this device so the setup can stop and resume later, in any tab. Never the
// household password or the AI key: those stay in memory only and are typed again after a pause. Dropped once the
// household is set up.
const STORAGE_KEY = 'hodi:setup-draft'

export interface SetupDraft {
  step: 0 | 1 | 2 | 3 | 4
  code: string
  name: string
  // The admin profile, its photo as a data URL (already resized to a small square).
  profile: { name: string; color: ProfileColor; photo: string | null } | null
  ai: string
  timeZone: string
  country: string | null
}

export const loadSetupDraft = (): SetupDraft | null => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return parsed && typeof parsed === 'object' && 'step' in parsed ? (parsed as SetupDraft) : null
  } catch {
    return null
  }
}

export const saveSetupDraft = (draft: SetupDraft) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Private browsing or a full storage: a reload starts again from the welcome screen.
  }
}

export const clearSetupDraft = () => {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing was kept.
  }
}

// Back to a Blob without fetch(), which the content security policy keeps from data URLs.
export const blobOf = (dataUrl: string) => {
  const [head, body = ''] = dataUrl.split(',')
  const type = /^data:([^;]+)/.exec(head ?? '')?.[1] ?? 'image/jpeg'
  const bytes = Uint8Array.from(atob(body), char => char.charCodeAt(0))
  return new Blob([bytes], { type })
}
