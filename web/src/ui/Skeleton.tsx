import styles from './Skeleton.module.css'

// Grey shapes where content is coming, from the charter's "Chargement" boards. They do not shimmer:
// nothing moves while waiting, which spares the battery.

interface BarProps {
  width: number | string
  height: number
  // Half the height by default: a pill.
  radius?: number
  className?: string
}

export const Bar = ({ width, height, radius = Math.min(6, height / 2), className = '' }: BarProps) => (
  <span className={`${styles.bar} ${className}`} style={{ width, height, borderRadius: radius }} />
)

// One desktop list row.
const RowSkeleton = () => (
  <div className={styles.row}>
    <div className={styles.top}>
      <div className={styles.lines}>
        <Bar width="92%" height={14} />
        <Bar width="70%" height={14} />
        <Bar width="85%" height={10} className={styles.summary} />
      </div>
      <Bar width={64} height={64} radius={10} />
    </div>
    <div className={styles.meta}>
      <span className={styles.source}>
        <Bar width={18} height={18} radius={5} />
        <Bar width={80} height={10} />
      </span>
      <Bar width={90} height={10} />
    </div>
  </div>
)

export const ListSkeleton = ({ rows = 4, layout = 'desktop' }: { rows?: number; layout?: 'desktop' | 'phone' }) => (
  <div className={`${styles.list} ${styles[layout]}`} aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => (
      <div key={index}>
        <RowSkeleton />
        <div className={styles.divider} />
      </div>
    ))}
  </div>
)

// A card of the mobile home's sliders.
export const SlideSkeleton = () => (
  <span className={styles.slide} aria-hidden="true">
    <Bar width="100%" height={132} radius={12} />
    <Bar width="95%" height={13} />
    <Bar width="70%" height={13} />
    <span className={styles.source}>
      <Bar width={18} height={18} radius={5} />
      <Bar width={70} height={10} radius={5} />
    </span>
  </span>
)
