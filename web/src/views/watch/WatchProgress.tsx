import { selectPlayback, selectTime, usePlayer } from '@videojs/react'
import { useEffect, useRef } from 'react'
import type { FeedItem } from '../../api.ts'
import { type ReadingProgress, getReadings, recordReading, updateReading } from '../../lib/reading-stats.ts'
import { forgetResumePosition, resumePositionOf } from '../../lib/resume.ts'

// Seen for good once this much of it played by, or once it played to its end.
const DONE_PROGRESS = 0.8
// Time counted no more than twice the length: a video left playing in a corner.
const MAX_TIME = 2
const MINUTE_S = 60

const hundredths = (fraction: number) => Math.round(fraction * 100) / 100

// As an article's reading, for a video or an episode: counted in the stats once it shows, then what was really
// played of it (the time it played, how far it went), sent when it is seen for good, paused, hidden or left.
const WatchProgress = ({ item }: { item: FeedItem }) => {
  const time = usePlayer(selectTime)
  const playback = usePlayer(selectPlayback)
  const state = useRef<{
    tracked: boolean
    furthest: number
    position: number
    playedS: number
    since: number | null
    done: boolean
    last: string
  } | null>(null)
  // Opened from "Reprendre": played from where it was left, once its length is known.
  const resume = useRef<number | null>(null)
  const duration = time?.duration ?? 0
  // Read by the sends on hide and on leave, set up once: they need the length known now, not at mount.
  const length = useRef(0)
  useEffect(() => {
    length.current = duration
  }, [duration])
  const playing = playback ? playback.started && !playback.paused && !playback.ended : false

  const current = (): ReadingProgress | null => {
    const tracked = state.current
    if (!tracked?.tracked) return null
    const running = tracked.since === null ? 0 : (performance.now() - tracked.since) / 1000
    const total = length.current / MINUTE_S
    const minutes = (tracked.playedS + running) / MINUTE_S
    return {
      minutes: Math.round((total > 0 ? Math.min(total * MAX_TIME, minutes) : minutes) * 10) / 10,
      progress: hundredths(tracked.furthest),
      position: hundredths(tracked.position),
      done: tracked.done,
      // The player's own length: "Il reste" in Reprendre counts from it.
      ...(total > 0 ? { estimate: Math.round(total * 10) / 10 } : {})
    }
  }

  const send = () => {
    const change = current()
    if (!change || !state.current) return
    const key = JSON.stringify(change)
    if (key === state.current.last) return
    state.current.last = key
    updateReading(item.id, change)
  }

  // Counted once it shows. Opened before it was tracked: it stays counted as seen, as it was.
  useEffect(() => {
    resume.current = resumePositionOf(item.id)
    forgetResumePosition()
    recordReading({
      id: item.id,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      minutes: 0,
      kind: item.kind === 'podcast' ? 'podcast' : 'video',
      estimate: (item.media?.durationSeconds ?? 0) / MINUTE_S,
      done: false,
      progress: 0,
      position: 0
    })
    const entry = getReadings().find(other => other.id === item.id)
    state.current = {
      tracked: entry?.done !== undefined,
      furthest: entry?.progress ?? 0,
      position: entry?.position ?? 0,
      playedS: (entry?.minutes ?? 0) * MINUTE_S,
      since: null,
      done: entry?.done === true,
      last: ''
    }
    state.current.last = JSON.stringify(current())

    const hidden = () => {
      if (document.visibilityState === 'hidden') send()
    }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      const tracked = state.current
      if (tracked && tracked.since !== null) {
        tracked.playedS += (performance.now() - tracked.since) / 1000
        tracked.since = null
      }
      send()
    }
    // The item's id says which video; its other fields come with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // Played time: counted between play and pause; a pause sends it.
  useEffect(() => {
    const tracked = state.current
    if (!tracked) return
    if (playing) {
      tracked.since ??= performance.now()
      return
    }
    if (tracked.since !== null) {
      tracked.playedS += (performance.now() - tracked.since) / 1000
      tracked.since = null
      send()
    }
    // send reads the latest state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // How far it went; seen for good is said at once.
  const at = time?.currentTime ?? 0
  const ended = playback?.ended ?? false
  useEffect(() => {
    const tracked = state.current
    if (!tracked || duration <= 0) return
    if (resume.current !== null && time) {
      void time.seek(resume.current * duration)
      resume.current = null
      return
    }
    tracked.position = ended ? 0 : Math.min(1, at / duration)
    tracked.furthest = Math.max(tracked.furthest, ended ? 1 : tracked.position)
    if (!tracked.done && (ended || tracked.furthest >= DONE_PROGRESS)) {
      tracked.done = true
      send()
    }
    // send reads the latest state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, duration, ended])

  return null
}

export default WatchProgress
