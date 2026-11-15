import { Bar } from '../../ui/Skeleton.tsx'
import styles from './Settings.module.css'

interface RowsSkeletonProps {
  rows: number
  // The mark before the text: a 44px square (AI, sources), a 44px round (profiles), the themes' grip and 44px
  // square, or nothing (accordion headers).
  lead?: 'square' | 'round' | 'theme' | 'none'
  // A second line under the label.
  hint?: boolean
  // What ends the row: a count, a switch, a button, a 34px round (an accordion's chevron).
  end?: 'count' | 'toggle' | 'button' | 'round'
}

const LEADS = {
  square: <Bar width={44} height={44} radius={12} />,
  round: <Bar width={44} height={44} radius={22} />,
  theme: (
    <>
      <Bar width={12} height={18} radius={3} />
      <Bar width={44} height={44} radius={8} />
    </>
  ),
  none: null
}

const ENDS = {
  count: <Bar width={52} height={12} />,
  toggle: <Bar width={56} height={34} radius={17} />,
  button: <Bar width={96} height={34} radius={17} />,
  round: <Bar width={34} height={34} radius={17} />
}

// A settings card while its rows come: the same card, rows of the same height, the same marks and controls,
// so nothing jumps when they show.
const RowsSkeleton = ({ rows, lead = 'square', hint = true, end = 'count' }: RowsSkeletonProps) => (
  <div className={styles.card} aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className={styles.row}>
        {LEADS[lead]}
        <span className={styles.rowText}>
          <Bar width={`${[42, 56, 36, 48][index % 4]}%`} height={12} />
          {hint && <Bar width={`${[64, 50, 58, 70][index % 4]}%`} height={10} />}
        </span>
        {ENDS[end]}
      </div>
    ))}
  </div>
)

export default RowsSkeleton
