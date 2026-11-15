import { UnauthorizedError, getJson, sendJson } from './http.ts'
import type { AdminProof } from './plugins.ts'

// Profiles. Mirrors server/db/profile-store.ts.

export const PROFILE_COLORS = [
  'belgium',
  'world',
  'tech',
  'science',
  'film-tv',
  'gaming',
  'ai',
  'broadcast',
  'sport',
  'music'
] as const
export type ProfileColor = (typeof PROFILE_COLORS)[number]

// adult: a parent of the household's young profiles. teen and child: young profiles their parents set.
export const PROFILE_KINDS = ['adult', 'teen', 'child'] as const
export type ProfileKind = (typeof PROFILE_KINDS)[number]

// A child's drawn avatar (web/src/assets/avatars).
export const PROFILE_AVATARS = [
  'fox',
  'pirate',
  'astronaut',
  'robot',
  'dragon',
  'panda',
  'owl',
  'kitten',
  'trex',
  'koala',
  'reporter',
  'scientist'
] as const
export type ProfileAvatarName = (typeof PROFILE_AVATARS)[number]

export const MAX_PROFILES = 5
export const MAX_PROFILE_NAME_LENGTH = 24

// admin: manages every profile and the household's shared data. member: its own profile and settings.
export type ProfileRole = 'admin' | 'member'

export interface Profile {
  id: number
  name: string
  color: ProfileColor
  role: ProfileRole
  kind: ProfileKind
  // A child's drawn avatar; null for the others.
  avatar: ProfileAvatarName | null
  // This device types a password before it opens it in "Qui lit ?": every adult. Only in the list: a profile sent
  // back after a change does not say.
  locked?: boolean
  // Its account has no password of its own (« Se connecter avec Google »): it opens through the plugin's button.
  loginOnly?: boolean
  // null: no photo, the initial shows.
  photoVersion: number | null
  // Added and never opened: its first visit, on any device, opens on the guided tour.
  tourPending: boolean
  // Its person signs in with their own account; an adult without one waits for "Connecter un appareil".
  hasAccount: boolean
}

// "À la une" stories looked at: the next front page puts others first. Sent even as the page closes.
export const sendSeenStories = (ids: string[]) =>
  fetch('/api/me/stories/seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
    keepalive: true
  })

// own: the profile of the account signed in on this device.
export const getProfiles = () =>
  getJson<{ profiles: Profile[]; current: number; own: number | null; serverAdmin: boolean }>('/profiles')

export interface ProfileChanges {
  name?: string
  color?: ProfileColor
  kind?: ProfileKind
  avatar?: ProfileAvatarName
}

export const createProfile = (name: string, color: ProfileColor, { kind, avatar }: ProfileChanges = {}) =>
  sendJson<Profile>('POST', '/profiles', { name, color, kind, avatar })

export const updateProfile = (id: number, changes: ProfileChanges) =>
  sendJson<Profile>('PATCH', `/profiles/${id}`, changes)

// An adult's profile with its account goes with the proof of the admin deleting it.
export const deleteProfile = (id: number, proof?: AdminProof) => sendJson<null>('DELETE', `/profiles/${id}`, proof)

// « Passer le rôle d'admin »: that adult becomes the household's admin, this profile a member. With the admin's proof.
export const makeAdmin = (id: number, proof: AdminProof) => sendJson<null>('PUT', `/profiles/${id}/admin`, proof)

// This device now reads as that profile, with the password it asks for, if any.
export const chooseProfile = (id: number, password?: string) =>
  sendJson<{ current: number }>('PUT', '/profiles/current', { id, password })

export const uploadProfilePhoto = async (id: number, photo: Blob) => {
  const response = await fetch(`/api/profiles/${id}/photo`, {
    method: 'PUT',
    headers: { 'Content-Type': photo.type },
    body: photo
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  if (!response.ok) throw new Error(`PUT photo failed with status ${response.status}`)
  return (await response.json()) as Profile
}

export const takeProfileTour = (id: number) => sendJson<Profile>('POST', `/profiles/${id}/tour`)

export const removeProfilePhoto = (id: number) => sendJson<Profile>('DELETE', `/profiles/${id}/photo`)

export const profilePhotoUrl = (profile: Profile) =>
  profile.photoVersion === null ? null : `/api/profiles/${profile.id}/photo?v=${profile.photoVersion}`
