import type { ProfileColor } from '../api.ts'

// The setup screens' answers, kept on this device so the setup can stop and resume later, in any tab. Never the
// password or the AI key: the password is sent with "Ton compte", the key stays in memory only and is typed again
// after a pause. Dropped once the household is set up. A draft of the screens before personal accounts, whose steps
// were not the same, is under the old key and is left alone.
const STORAGE_KEY = 'hodi:setup-draft-2'

export interface SetupDraft {
  // 6: « Le serveur est prêt », between the account and the household. 7: « Plugins trouvés ». 8: a plugin's step.
  step: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  // At 8, which of the plugins' steps: its plugin and its id, so a reload comes back to it.
  pluginStep?: { plugin: string; id: string }
  code: string
  // The server admin's address, typed in "Ton compte".
  email: string
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
