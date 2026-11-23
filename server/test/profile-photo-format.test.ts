import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { photoFormatOf } from '../http/profile-photos.ts'

// Without sharp, a photo's size cannot be read: it is refused rather than kept unchecked.
test('a profile photo is checked by sharp, and refused without it', async () => {
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#c86' } })
    .png()
    .toBuffer()
  assert.equal(await photoFormatOf(png), 'image/png')
  assert.equal(await photoFormatOf(png, null), null)
})

// What the bytes are decides, whatever the request says; a picture far larger than the app ever makes is refused
// before it is unpacked: a few kilobytes could unpack into gigabytes.
test('a profile photo that is no picture, or far too large, is refused', async () => {
  assert.equal(await photoFormatOf(Buffer.from('not a picture')), null)
  const huge = await sharp({ create: { width: 1100, height: 8, channels: 3, background: '#000' } })
    .png()
    .toBuffer()
  assert.ok(huge.length < 64 * 1024)
  assert.equal(await photoFormatOf(huge), null)
})
