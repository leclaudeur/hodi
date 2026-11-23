import type express from 'express'
import type { ProfileKind } from '../db/profile-store.ts'

// The profile a request is for, set by the app's middleware.
export const profileIdOf = (response: express.Response) => response.locals.profileId as number

// Whether that profile is the household's admin (always, in an app without profiles).
export const isAdminOf = (response: express.Response) => response.locals.admin === true

// The kind of the profile a request is for: an adult is a parent of the household's young profiles.
export const kindOf = (response: express.Response) => (response.locals.kind as ProfileKind | undefined) ?? 'adult'
export const isParentOf = (response: express.Response) => kindOf(response) === 'adult'
