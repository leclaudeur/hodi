import type { CSSProperties } from 'react'
import styles from './Confetti.module.css'

const COUNT = 80
// The app's colours: the rust, the topics', the AI's violet.
const COLORS = [
  '--rust',
  '--topic-belgium',
  '--topic-world',
  '--topic-tech',
  '--topic-science',
  '--topic-film-tv',
  '--topic-gaming',
  '--ai'
]

// A celebration falling over the whole screen: the tour's end, a new level. Gone with reduced motion.
// delay: in ms, for a celebration that builds up before it falls.
const Confetti = ({ delay = 0 }: { delay?: number }) => (
  <div className={styles.confetti} style={{ '--start': `${delay}ms` } as CSSProperties} aria-hidden="true">
    {Array.from({ length: COUNT }, (_, index) => (
      <span
        key={index}
        style={
          {
            '--x': `${(index * 37) % 100}vw`,
            '--drift': `${((index * 53) % 41) - 20}vw`,
            '--turn': `${((index * 97) % 720) - 360}deg`,
            '--delay': `${(index % 16) * 45}ms`,
            '--color': `var(${COLORS[index % COLORS.length]})`
          } as CSSProperties
        }
      />
    ))}
  </div>
)

export default Confetti
