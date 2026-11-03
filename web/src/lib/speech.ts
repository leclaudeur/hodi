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
  const keepAlive = useRef<number | undefined>(undefined)
  // Paused by a tap: the keep-alive leaves the voice paused.
  const paused = useRef(false)

  const stopKeepAlive = () => {
    window.clearInterval(keepAlive.current)
    keepAlive.current = undefined
  }

  const startKeepAlive = () => {
    stopKeepAlive()
    if (!NEEDS_KEEP_ALIVE) return
    keepAlive.current = window.setInterval(() => {
      const synth = window.speechSynthesis
      if (paused.current || !synth.speaking) return
      synth.pause()
      synth.resume()
    }, KEEP_ALIVE_MS)
  }

  const clearHighlight = () => {
    content.current?.querySelectorAll(`[${SPEAKING_ATTRIBUTE}]`).forEach(block => {
      block.removeAttribute(SPEAKING_ATTRIBUTE)
    })
  }

  const mark = (block: HTMLElement) => {
    clearHighlight()
    block.setAttribute(SPEAKING_ATTRIBUTE, '')
    block.scrollIntoView({ block: 'center', behavior: 'smooth' })
    heard.current?.(block)
  }

  const silence = () => {
    stopKeepAlive()
    if (isSupported()) window.speechSynthesis.cancel()
    forgetQueued()
    releasePlaybackChannel()
  }

  // Leaving the article stops the voice.
  useEffect(
    () => () => {
      session.current++
      window.clearInterval(keepAlive.current)
      if (isSupported()) window.speechSynthesis.cancel()
      forgetQueued()
      releasePlaybackChannel()
    },
    []
  )

  const stop = () => {
    session.current++
    silence()
    clearHighlight()
    setState('idle')
  }

  const blocksOf = () => {
    const root = content.current
    if (!root) return []
    return [...root.querySelectorAll<HTMLElement>(BLOCKS)].filter(
      // A list item holding paragraphs is read through them.
      block => block.textContent?.trim() && !block.querySelector(BLOCKS)
    )
  }

  // Queues the blocks from start on, all at once: iOS may refuse to start a voice outside the tap that asked for it.
  const speakFrom = (blocks: HTMLElement[], start: number, current: number) => {
    const synth = window.speechSynthesis
    const voiceLang = VOICE_LANGS[lang]
    const voice = pickVoice(synth.getVoices(), voiceLang)
    forgetQueued()

    const finish = () => {
      stopKeepAlive()
      forgetQueued()
      clearHighlight()
      releasePlaybackChannel()
      setState('idle')
    }

    blocks.slice(start).forEach((block, offset) => {
      const index = start + offset
      const utterance = new SpeechSynthesisUtterance(block.textContent?.trim() ?? '')
      utterance.lang = voiceLang
      if (voice) utterance.voice = voice
      keepQueued(utterance)

      utterance.onstart = () => {
        if (current !== session.current) return
        spoken.current = index
        mark(block)
      }

      // Some voices (the online ones of Chrome and Edge) end an utterance and drop the rest of the queue:
      // once nothing is left playing, the blocks not read yet are queued again.
      const settle = () => {
        if (current !== session.current) return
        if (index === blocks.length - 1) return finish()
        window.setTimeout(() => {
          if (current !== session.current || synth.speaking || synth.pending) return
          if (spoken.current >= blocks.length - 1) return finish()
          speakFrom(blocks, spoken.current + 1, current)
        }, 250)
      }
      utterance.onend = settle
      utterance.onerror = event => {
        // A stop cancels the queue: nothing more to read. A block the voice fails on is skipped.
        if (event.error === 'canceled' || event.error === 'interrupted') return
        if (current === session.current) spoken.current = Math.max(spoken.current, index)
        settle()
      }

      synth.speak(utterance)
    })
  }

  // from: the voice starts at the first block inside it (or at it), else at the top.
  const play = (from?: HTMLElement | null) => {
    const all = blocksOf()
    const first = from ? all.findIndex(block => from === block || from.contains(block)) : 0
    const blocks = all.slice(Math.max(first, 0))
    if (blocks.length === 0 || !isSupported()) return
    askPlaybackChannel()

    const current = ++session.current
    const synth = window.speechSynthesis

    // On iOS, a speak() right after cancel() is dropped: only cancel what is really playing.
    if (synth.speaking || synth.pending) synth.cancel()
    // A voice paused before the jump would keep the new one paused too.
    if (synth.paused) synth.resume()
    spoken.current = -1
    paused.current = false
    speakFrom(blocks, 0, current)
    startKeepAlive()

    setState('playing')
  }

  const toggle = (from?: HTMLElement | null) => {
    if (state === 'idle') {
      play(from)
    } else if (state === 'playing') {
      paused.current = true
      window.speechSynthesis.pause()
      setState('paused')
    } else if (state === 'paused') {
      paused.current = false
      window.speechSynthesis.resume()
      setState('playing')
    } else {
      stop()
    }
  }

  // Moved by hand while the voice runs: it goes on from there.
  const jump = (from: HTMLElement | null) => {
    if (state !== 'idle') play(from)
  }

  return { supported, state, toggle, stop, jump }
}
