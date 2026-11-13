import { type RefObject, useEffect, useRef, useState } from 'react'
import type { Language } from '../api.ts'

// loading is kept for a voice that takes time to start; the browser's voices start at once.
export type SpeechState = 'idle' | 'loading' | 'playing' | 'paused'

// Blocks read one by one: each is highlighted while it is spoken.
const BLOCKS = 'p, h2, h3, h4, li, blockquote'
// Marks the block being read, for the reader's styles.
export const SPEAKING_ATTRIBUTE = 'data-speaking'

const VOICE_LANGS: Record<Language, string> = { fr: 'fr-FR', en: 'en-GB' }

const isSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

// The voices downloaded in the system settings ("Premium", "Améliorée") read best: picked first.
const QUALITY = /premium|enhanced|améliorée|natural|neural/i

const pickVoice = (voices: SpeechSynthesisVoice[], voiceLang: string) => {
  const matching = voices.filter(candidate => candidate.lang.replace('_', '-').startsWith(voiceLang))
  return (
    matching.find(candidate => QUALITY.test(candidate.name)) ??
    matching.find(candidate => candidate.localService) ??
    matching[0]
  )
}

// Safari plays speech on the ringer's channel: with the iPhone on silent, nothing is heard.
// Asking for the media channel (iOS 17+) lets it play like a video.
const askPlaybackChannel = () => {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'playback'
}

// Given back once the voice stops.
const releasePlaybackChannel = () => {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'auto'
}

// Chrome on a computer stops a voice after about 15 s of one utterance, without its end event: the voice
// hangs and the button stays on Pause. A pause and resume every few seconds keeps it going. Not on Android,
// where a pause ends the voice.
const NEEDS_KEEP_ALIVE =
  typeof navigator !== 'undefined' && /Chrome\//.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)
const KEEP_ALIVE_MS = 10_000

// Kept until spoken: some browsers lose the events of an utterance nothing refers to any more.
const queued: SpeechSynthesisUtterance[] = []
const forgetQueued = () => {
  queued.length = 0
}
const keepQueued = (utterance: SpeechSynthesisUtterance) => {
  queued.push(utterance)
}

// Stops the voice and lets go of what it held.
const cancelVoice = () => {
  if (isSupported()) window.speechSynthesis.cancel()
  forgetQueued()
  releasePlaybackChannel()
}

const clearHighlightIn = (root: HTMLElement | null) => {
  root?.querySelectorAll(`[${SPEAKING_ATTRIBUTE}]`).forEach(block => {
    block.removeAttribute(SPEAKING_ATTRIBUTE)
  })
}

const markBlock = (root: HTMLElement | null, block: HTMLElement, heard?: (block: HTMLElement) => void) => {
  clearHighlightIn(root)
  block.setAttribute(SPEAKING_ATTRIBUTE, '')
  block.scrollIntoView({ block: 'center', behavior: 'smooth' })
  heard?.(block)
}

const blocksIn = (root: HTMLElement | null) => {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(BLOCKS)].filter(
    // A list item holding paragraphs is read through them.
    block => block.textContent?.trim() && !block.querySelector(BLOCKS)
  )
}

// The blocks from the first one inside from (or from itself) on, else all of them.
const blocksFrom = (root: HTMLElement | null, from?: HTMLElement | null) => {
  const all = blocksIn(root)
  const first = from ? all.findIndex(block => from === block || from.contains(block)) : 0
  return all.slice(Math.max(first, 0))
}

const readySynth = () => {
  const synth = window.speechSynthesis
  // On iOS, a speak() right after cancel() is dropped: only cancel what is really playing.
  if (synth.speaking || synth.pending) synth.cancel()
  // A voice paused before the jump would keep the new one paused too.
  if (synth.paused) synth.resume()
  return synth
}

const utteranceOf = (block: HTMLElement, voiceLang: string, voice: SpeechSynthesisVoice | undefined) => {
  const utterance = new SpeechSynthesisUtterance(block.textContent?.trim() ?? '')
  utterance.lang = voiceLang
  if (voice) utterance.voice = voice
  keepQueued(utterance)
  return utterance
}

// Chrome's keep-alive (NEEDS_KEEP_ALIVE), which leaves a voice paused by a tap paused.
const useKeepAlive = (timer: RefObject<number | undefined>, paused: RefObject<boolean>) => {
  const stop = () => {
    window.clearInterval(timer.current)
    timer.current = undefined
  }
  const start = () => {
    stop()
    if (!NEEDS_KEEP_ALIVE) return
    timer.current = window.setInterval(() => {
      const synth = window.speechSynthesis
      if (paused.current || !synth.speaking) return
      synth.pause()
      synth.resume()
    }, KEEP_ALIVE_MS)
  }
  return { start, stop }
}

interface Reading {
  synth: SpeechSynthesis
  voiceLang: string
  // Whether no stop came since this reading started.
  isCurrent: () => boolean
  // The last block the voice started.
  spoken: { current: number }
  mark: (block: HTMLElement) => void
  finish: () => void
}

// Queues the blocks from start on, all at once: iOS may refuse to start a voice outside the tap that asked for it.
const queueFrom = (blocks: HTMLElement[], start: number, reading: Reading) => {
  const { synth, voiceLang, isCurrent, spoken, finish } = reading
  const voice = pickVoice(synth.getVoices(), voiceLang)
  forgetQueued()

  blocks.slice(start).forEach((block, offset) => {
    const index = start + offset
    const utterance = utteranceOf(block, voiceLang, voice)

    utterance.onstart = () => {
      if (!isCurrent()) return
      spoken.current = index
      reading.mark(block)
    }

    // Some voices (the online ones of Chrome and Edge) end an utterance and drop the rest of the queue:
    // once nothing is left playing, the blocks not read yet are queued again.
    const settle = () => {
      if (!isCurrent()) return
      if (index === blocks.length - 1) return finish()
      window.setTimeout(() => {
        if (!isCurrent() || synth.speaking || synth.pending) return
        if (spoken.current >= blocks.length - 1) return finish()
        queueFrom(blocks, spoken.current + 1, reading)
      }, 250)
    }
    utterance.onend = settle
    utterance.onerror = event => {
      // A stop cancels the queue: nothing more to read. A block the voice fails on is skipped.
      if (event.error === 'canceled' || event.error === 'interrupted') return
      if (isCurrent()) spoken.current = Math.max(spoken.current, index)
      settle()
    }

    synth.speak(utterance)
  })
}

// The browser's own voices read the article (free, offline, nothing leaves the device).
// The block being read is marked.
// onBlock hears each block as the voice reaches it, for a view that follows the voice.
export const useSpeech = (
  content: RefObject<HTMLElement | null>,
  lang: Language,
  onBlock?: (block: HTMLElement) => void
) => {
  const [state, setState] = useState<SpeechState>('idle')
  const heard = useRef(onBlock)
  useEffect(() => {
    heard.current = onBlock
  })
  const supported = isSupported()
  // Bumped by every stop: the end of a voice stopped since is ignored.
  const session = useRef(0)
  // The last block the voice started.
  const spoken = useRef(-1)
  // Paused by a tap: the keep-alive leaves the voice paused.
  const paused = useRef(false)
  const keepAliveTimer = useRef<number | undefined>(undefined)
  const keepAlive = useKeepAlive(keepAliveTimer, paused)
  const clearHighlight = () => clearHighlightIn(content.current)

  const mark = (block: HTMLElement) => markBlock(content.current, block, heard.current)

  // Leaving the article stops the voice.
  useEffect(
    () => () => {
      session.current++
      window.clearInterval(keepAliveTimer.current)
      cancelVoice()
    },
    []
  )

  const stop = () => {
    session.current++
    keepAlive.stop()
    cancelVoice()
    clearHighlight()
    setState('idle')
  }

  const finish = () => {
    keepAlive.stop()
    forgetQueued()
    clearHighlight()
    releasePlaybackChannel()
    setState('idle')
  }

  // from: the voice starts at the first block inside it (or at it), else at the top.
  const play = (from?: HTMLElement | null) => {
    const blocks = blocksFrom(content.current, from)
    if (blocks.length === 0 || !isSupported()) return
    askPlaybackChannel()

    const current = ++session.current
    const synth = readySynth()
    spoken.current = -1
    paused.current = false
    queueFrom(blocks, 0, {
      synth,
      voiceLang: VOICE_LANGS[lang],
      isCurrent: () => current === session.current,
      spoken,
      mark,
      finish
    })
    keepAlive.start()

    setState('playing')
  }

  // A voice still loading stops; one playing pauses, and a paused one goes on.
  const toggle = (from?: HTMLElement | null) => {
    if (state === 'idle') return play(from)
    if (state === 'loading') return stop()
    const pausing = state === 'playing'
    paused.current = pausing
    if (pausing) window.speechSynthesis.pause()
    else window.speechSynthesis.resume()
    setState(pausing ? 'paused' : 'playing')
  }

  // Moved by hand while the voice runs: it goes on from there.
  const jump = (from: HTMLElement | null) => {
    if (state !== 'idle') play(from)
  }

  return { supported, state, toggle, stop, jump }
}
