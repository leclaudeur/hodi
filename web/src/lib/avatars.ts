import type { ProfileAvatarName } from '../api.ts'

// A child's drawn avatars, served with the app's other assets (hashed, kept by the browser for good).
const FILES = import.meta.glob<string>('../assets/avatars/*.webp', { eager: true, query: '?url', import: 'default' })

export const avatarUrl = (name: ProfileAvatarName) => FILES[`../assets/avatars/${name}.webp`] ?? null
