import { useEffect, useSyncExternalStore } from 'react'
import {
  type Profile,
  type ProfileChanges,
  type ProfileColor,
  chooseProfile,
  clearDataCache,
  createProfile,
  deleteProfile,
  getProfiles,
  removeProfilePhoto,
  setParentalPin,
  setProfilePin,
  takeProfileTour,
  updateProfile,
  uploadProfilePhoto
} from '../api.ts'
import { RECENT_SEARCHES_KEY } from './recent-searches.ts'
import { dropRequestsOf } from './requests.ts'
import { SEEN_STORIES_KEY } from './seen-stories.ts'
import { clearUserState, sendPendingChanges } from './user-state.ts'

// The household's profiles ("Qui lit ?") and the one this device reads as.

export interface ProfilesState {
  profiles: Profile[]
  current: number | null
  // Whether the household has a Code parental.
  parentalCode: boolean
}

let state: ProfilesState | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

const commit = (next: ProfilesState) => {
  state = next
  listeners.forEach(listener => listener())
}

export const refreshProfiles = () => {
  loading ??= getProfiles()
    .then(({ profiles, current, parentalCode }) => commit({ profiles, current, parentalCode }))
    .finally(() => {
      loading = null
    })
  return loading
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// null until the list has arrived. fresh: asked again even when known ("Qui lit ?", after a login).
// onError: the list could not be loaded (a lost session among others).
export const useProfiles = ({
  fresh = false,
  onError
}: { fresh?: boolean; onError?: (error: unknown) => void } = {}) => {
  const value = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (!state || fresh) refreshProfiles().catch((error: unknown) => onError?.(error))
    // Loaded once for the app: later changes come through this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return value
}

// Outside React: the profile this device reads as, null until the list has arrived.
export const currentProfileId = () => state?.current ?? null

export const useCurrentProfile = () => {
  const value = useProfiles({ onError: () => {} })
  return value?.profiles.find(profile => profile.id === value.current) ?? null
}

// The household's admin reads here: the profiles and the shared data are its to change.
export const useIsAdmin = () => useCurrentProfile()?.role === 'admin'

export const isYoung = (profile: Pick<Profile, 'kind'>) => profile.kind !== 'adult'

const replace = (profile: Profile) => {
  if (state) commit({ ...state, profiles: state.profiles.map(other => (other.id === profile.id ? profile : other)) })
}

// Its tour starts: not offered again, on this device or any other. Kept waiting when the server does not hear it.
export const takeTour = (profile: Profile) => {
  replace({ ...profile, tourPending: false })
  takeProfileTour(profile.id).then(replace, () => {})
}

// The photo, made square and small on the device before it is sent: the server only stores it.
const PHOTO_SIZE = 256
const PHOTO_QUALITY = 0.85
// What a photo may be when picked: it is then cropped square and made small here, before it is sent.
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
export const MAX_PICKED_PHOTO_BYTES = 20_000_000

export const makePhoto = async (file: File): Promise<Blob> => {
  const image = await createImageBitmap(file)
  const side = Math.min(image.width, image.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = PHOTO_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No canvas')
  context.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    PHOTO_SIZE,
    PHOTO_SIZE
  )
  image.close()

  const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, PHOTO_QUALITY))
  // Older Safari has no WebP encoder and hands back a PNG: a JPEG is smaller.
  const webp = await encode('image/webp')
  const photo = webp?.type === 'image/webp' ? webp : await encode('image/jpeg')
  if (!photo) throw new Error('Photo not made')
  return photo
}

// A young profile changes which adults the Code parental guards: the list is asked again.
export const addProfile = async (
  name: string,
  color: ProfileColor,
  photo: Blob | null,
  { kind, avatar }: Omit<ProfileChanges, 'name' | 'color'> = {}
) => {
  let profile = await createProfile(name, color, { kind, avatar })
  if (photo && profile.kind !== 'child') profile = await uploadProfilePhoto(profile.id, photo).catch(() => profile)
  if (state) commit({ ...state, profiles: [...state.profiles, profile] })
  if (profile.kind !== 'adult') void refreshProfiles().catch(() => {})
  return profile
}

export const editProfile = async (
  id: number,
  changes: ProfileChanges,
  // undefined: unchanged; null: removed.
  photo?: Blob | null
) => {
  const before = state?.profiles.find(profile => profile.id === id)
  let profile = await updateProfile(id, changes)
  if (photo && profile.kind !== 'child') profile = await uploadProfilePhoto(id, photo)
  else if (photo === null && profile.photoVersion !== null) profile = await removeProfilePhoto(id)
  replace(profile)
  if (before && before.kind !== profile.kind) void refreshProfiles().catch(() => {})
  return profile
}

export const changeParentalPin = async (pin: string | null, current?: string) => {
  const { parentalCode } = await setParentalPin(pin, current)
  await refreshProfiles().catch(() => {})
  if (state) commit({ ...state, parentalCode })
}

export const changePin = async (id: number, pin: string | null, current?: string) => {
  const profile = await setProfilePin(id, pin, current)
  replace(profile)
  return profile
}

export const removeProfile = async (id: number) => {
  await deleteProfile(id)
  dropRequestsOf(id)
  if (!state) return
  commit({ ...state, profiles: state.profiles.filter(profile => profile.id !== id) })
  void refreshProfiles().catch(() => {})
  // It was open here: "Qui lit ?" again.
  if (id === state.current) window.location.reload()
}

// What one profile kept on this device: another one starts from its own.
const DEVICE_KEYS = [RECENT_SEARCHES_KEY, SEEN_STORIES_KEY]

// Sent as the app reloads on another profile: the screen empties at once rather than showing the last one's.
export const PROFILE_SWITCHING = 'hodi:profile-switching'

export type SwitchResult = 'switched' | 'pending'

// pending: changes made offline still wait to be sent, and would go to the wrong profile.
// pin: the profile's, when it has one (a wrong one throws a RequestError).
// opened: once the server took the PIN, before the app reloads on the profile (a green "right" to see).
export const switchProfile = async (
  id: number,
  chosen: boolean,
  pin?: string,
  opened?: () => Promise<void>
): Promise<SwitchResult> => {
  const same = id === state?.current
  if (same && chosen) {
    window.location.hash = '#/'
    return 'switched'
  }
  if (!same && !(await sendPendingChanges())) return 'pending'

  await chooseProfile(id, pin)
  await opened?.()
  window.dispatchEvent(new Event(PROFILE_SWITCHING))
  if (!same) {
    clearUserState()
    DEVICE_KEYS.forEach(key => {
      try {
        localStorage.removeItem(key)
      } catch {
        // Nothing kept.
      }
    })
    await clearDataCache()
  }
  // The home's address without going there first, which would draw it with this profile's content.
  history.replaceState(null, '', '#/')
  window.location.reload()
  return 'switched'
}

// A photo as a data URL: its preview, or kept in the tab while the setup screens are open.
export const dataUrlOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Not read'))
    reader.readAsDataURL(blob)
  })
