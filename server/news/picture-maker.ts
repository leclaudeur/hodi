import type Sharp from 'sharp'

export type PictureMaker = typeof Sharp

// sharp's prebuilt binaries need an x86-64-v2 processor, and its WebAssembly build needs SSE4.1. A virtual machine with
// a generic CPU (kvm64, qemu64) has neither: Hodi still starts there, and shows each picture from its own site.
const load = async (): Promise<PictureMaker | null> => {
  try {
    const sharp = (await import('sharp')).default
    // One picture at a time, without libvips' own cache: the server is a small home computer.
    sharp.cache(false)
    sharp.concurrency(1)
    return sharp
  } catch (error) {
    const reason = error instanceof Error ? (error.message.split('\n').find(line => /CPU|SIMD/.test(line)) ?? '') : ''
    console.warn(`Pictures are not made smaller on this processor; they show from their site. ${reason}`.trim())
    return null
  }
}

export const pictureMaker = await load()
