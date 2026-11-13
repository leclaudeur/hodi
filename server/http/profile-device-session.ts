import type express from 'express'
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createProfileDeviceToken,
  readCookie,
  readProfileDeviceToken,
  sessionCookie
} from '../auth/session.ts'
import { PROFILE_DEVICE_IDLE, type ProfileDevice, type ProfileDeviceStore } from '../db/profile-device-store.ts'

// A young profile's own device: its session cookie names its row in the profile's Appareils, and opens that
// profile only. While it is used, its cookie is sent again so that it lasts 90 days from the last use.

if (PROFILE_DEVICE_IDLE / 1000 > SESSION_TTL_SECONDS) throw new Error('A linked device would outlive its cookie')

export const profileDeviceSession = (devices: ProfileDeviceStore | undefined, secret: Buffer, now: () => number) => {
  const cookieForDevice = (device: ProfileDevice) =>
    sessionCookie(createProfileDeviceToken(device.id, device.createdAt, secret))

  // The device and, when its last use has just moved, its cookie again; null without a linked device.
  const deviceOf = (request: express.Request): { device: ProfileDevice; cookie: string | null } | null => {
    const token = readCookie(request.get('cookie'), SESSION_COOKIE)
    const named = token && devices ? readProfileDeviceToken(token, secret) : null
    const device = named === null ? null : (devices?.get(named.id, now()) ?? null)
    // A removed device's cookie names a row that is gone: one linked later may have its id, never its creation time.
    // An old cookie without that time only opens a device linked before it existed, and is replaced at once.
    if (!device || (named!.createdAt === null ? !device.legacy : named!.createdAt !== device.createdAt)) return null
    const moved = devices!.touch(device, now())
    return { device, cookie: moved || named!.createdAt === null ? cookieForDevice(device) : null }
  }

  // A device just linked with a code: its row, named after its browser, and its cookie.
  const link = (profileId: number, request: express.Request) => {
    if (!devices) throw new Error('No profile device store')
    return cookieForDevice(devices.create(profileId, request.get('user-agent') ?? '', now()))
  }

  return { deviceOf, link }
}
