import {
  Container,
  Controls,
  FullscreenButton,
  Gesture,
  Hotkey,
  MuteButton,
  PlayButton,
  StatusAnnouncer,
  Time,
  TimeSlider,
  createPlayer,
  selectPlayback,
  usePlayer
} from '@videojs/react'
import { Audio, audioFeatures } from '@videojs/react/audio'
import { I18nProvider } from '@videojs/react/i18n'
import '@videojs/react/i18n/locales/fr/register'
import { useLanguage } from '../../lib/i18n.ts'
import { YouTubeVideo } from '@videojs/react/media/youtube-video'
import { videoFeatures } from '@videojs/react/video'
import { AudioLines, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { FeedItem, ItemMedia } from '../../api.ts'
import styles from './WatchPlayer.module.css'
import WatchProgress from './WatchProgress.tsx'

// Video.js drives YouTube's player (its own controls hidden) and the podcasts' <audio>, under Hodi's controls.
const video = createPlayer({ features: videoFeatures })
const VideoPlayer = video.Player
const AudioPlayer = createPlayer({ features: audioFeatures }).Player

// "Play" over the cover whenever it is not playing, then the bar: play, time, timeline, duration, sound, full screen.
// video: the cover hides YouTube's own screens (title, suggestions) while paused; only its picture shows while playing.
// audio: a cover that stays.
interface SkinProps {
  children: ReactNode
  kind: 'video' | 'audio'
  cover?: ReactNode
}

const Skin = ({ children, kind, cover }: SkinProps) => {
  const { t } = useTranslation()
  const playback = usePlayer(selectPlayback)
  const playing = playback ? playback.started && !playback.paused && !playback.ended : false

  return (
    <Container className={`${styles.player} ${styles[kind]}`}>
      {children}
      <div className={styles.poster} hidden={kind === 'video' && playing}>
        {cover}
      </div>

      <PlayButton
        className={styles.start}
        render={(props, state) => (
          <button {...props} hidden={state.started && !state.paused && !state.ended}>
            <Play size={16} fill="currentColor" aria-hidden="true" />
            {t(state.ended ? 'videos.replay' : state.started ? 'videos.resume' : 'videos.play')}
          </button>
        )}
      />

      {/* An episode has no picture to uncover: its bar always shows. */}
      <Controls.Root visibility={kind === 'audio' ? 'always' : 'auto'}>
        <Controls.Content className={styles.controls}>
          <PlayButton
            className={styles.control}
            render={(props, state) => (
              <button {...props}>
                {state.paused ? (
                  <Play size={14} fill="currentColor" aria-hidden="true" />
                ) : (
                  <Pause size={14} fill="currentColor" aria-hidden="true" />
                )}
              </button>
            )}
          />
          <Time.Value type="current" className={styles.time} />
          <TimeSlider.Root className={styles.slider}>
            <TimeSlider.Track className={styles.track}>
              <TimeSlider.Buffer className={styles.buffer} />
              <TimeSlider.Fill className={styles.fill} />
            </TimeSlider.Track>
            <TimeSlider.Thumb className={styles.thumb} />
          </TimeSlider.Root>
          <Time.Value type="duration" className={styles.time} />
          <MuteButton
            className={styles.control}
            render={(props, state) => (
              <button {...props}>
                {state.muted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
              </button>
            )}
          />
          {kind === 'video' && (
            <FullscreenButton
              className={styles.control}
              render={(props, state) => (
                <button {...props}>
                  {state.fullscreen ? (
                    <Minimize size={15} aria-hidden="true" />
                  ) : (
                    <Maximize size={15} aria-hidden="true" />
                  )}
                </button>
              )}
            />
          )}
        </Controls.Content>
      </Controls.Root>

      {/* YouTube never gets the pointer, so its own overlays stay hidden: a click on the picture plays or pauses. */}
      <Gesture type="tap" action="togglePaused" pointer="mouse" />
      {kind === 'video' && <Gesture type="doubletap" action="toggleFullscreen" />}
      <Hotkey keys="Space" action="togglePaused" />
      <Hotkey keys="m" action="toggleMuted" />
      <Hotkey keys="ArrowLeft" action="seekStep" value={-10} />
      <Hotkey keys="ArrowRight" action="seekStep" value={10} />
      {kind === 'video' && <Hotkey keys="f" action="toggleFullscreen" />}
      <StatusAnnouncer />
    </Container>
  )
}

// YouTube turns its captions on by itself for some videos: they are switched off as soon as they show.
// Hodi has no captions button, so nothing ever asks for them.
type CaptionTracks = EventTarget & Iterable<{ mode: string }>

const hideCaptions = (tracks: CaptionTracks) => {
  for (const track of tracks) if (track.mode === 'showing') track.mode = 'disabled'
}

const NoCaptions = () => {
  const media: object | null | undefined = video.useMedia()
  const tracks = media && 'textTracks' in media ? (media.textTracks as CaptionTracks) : null

  useEffect(() => {
    if (!tracks) return
    const off = () => hideCaptions(tracks)
    tracks.addEventListener('addtrack', off)
    tracks.addEventListener('change', off)
    off()
    return () => {
      tracks.removeEventListener('addtrack', off)
      tracks.removeEventListener('change', off)
    }
  }, [tracks])

  return null
}

// The privacy-enhanced embed. The app sends no referrer, but YouTube refuses to play embeds without one:
// the player gets the app's origin only.
const youtubeSource = (videoId: string) => ({
  src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
  engine: {
    youtube: { rel: 0 as const, iv_load_policy: 3 as const, referrerPolicy: 'strict-origin-when-cross-origin' as const }
  }
})

interface WatchPlayerProps {
  item: FeedItem & { media: ItemMedia }
}

// Plays a video or an episode in the page, with the same controls for both.
const WatchPlayer = ({ item }: WatchPlayerProps) => {
  const { media } = item
  // The player's own labels (play, mute, full screen…) in the interface language: English is Video.js's own.
  const language = useLanguage()

  return (
    <I18nProvider locale={language}>
      {media.type === 'youtube' ? (
        <VideoPlayer title={item.title}>
          <Skin kind="video" cover={item.image && <img src={item.image} alt="" decoding="async" />}>
            <YouTubeVideo source={youtubeSource(media.videoId)} playsInline />
            <NoCaptions />
            <WatchProgress item={item} />
          </Skin>
        </VideoPlayer>
      ) : (
        <AudioPlayer title={item.title} poster={item.image}>
          <Skin
            kind="audio"
            cover={
              item.image ? (
                <img src={item.image} alt="" decoding="async" />
              ) : (
                <span className={styles.wave} aria-hidden="true">
                  <AudioLines size={120} strokeWidth={1.25} />
                </span>
              )
            }
          >
            <Audio src={media.url} preload="none" />
            <WatchProgress item={item} />
          </Skin>
        </AudioPlayer>
      )}
    </I18nProvider>
  )
}

export default WatchPlayer
