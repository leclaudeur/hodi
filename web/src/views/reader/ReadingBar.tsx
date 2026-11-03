import { type RefObject, useEffect, useRef } from 'react'
import styles from './Reader.module.css'
import { textProgress } from './reading-progress.ts'

// The rust line under the reader's bar: how far the text has been read, until its last line shows.
// Drawn with a transform, once per frame at most, so scrolling stays cheap on battery.
// More than this at once is a jump, not a scroll.
const JUMP = 0.15

const ReadingBar = ({ target }: { target: RefObject<HTMLElement | null> }) => {
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    let shown = 0

    const update = () => {
      frame = 0
      if (!target.current || !bar.current) return
      const progress = textProgress(target.current)
      // Glides only on a jump (a short text full at once, back where it was left): under the finger, it follows at once.
      bar.current.style.transition = Math.abs(progress - shown) > JUMP ? '' : 'none'
      bar.current.style.transform = `scaleX(${progress})`
      shown = progress
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    // Images, the AI cards or a new text size change the length of the text without a scroll.
    const resizes = new ResizeObserver(schedule)
    if (target.current) resizes.observe(target.current)

    update()
    // Captured: the scroll of any box, the desktop panel included.
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      window.cancelAnimationFrame(frame)
      resizes.disconnect()
      document.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [target])

  return (
    <div className={styles.progress} aria-hidden="true">
      <div ref={bar} className={styles.progressFill} />
    </div>
  )
}

export default ReadingBar
