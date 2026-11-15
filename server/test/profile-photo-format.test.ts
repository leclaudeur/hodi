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
