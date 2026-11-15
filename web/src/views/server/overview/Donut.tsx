import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import styles from './OverviewCards.module.css'

export interface Part {
  key: string
  name: string
  value: number
  colour: string
}

// A ring with its total in the middle; nothing to show draws a plain grey ring.
const Donut = ({ parts, centre, caption }: { parts: Part[]; centre: string; caption: string }) => {
  const shown = parts.some(part => part.value) ? parts : [{ key: 'none', name: '', value: 1, colour: 'var(--control)' }]
  return (
    <div className={styles.donut}>
      <ResponsiveContainer width="100%" height={132}>
        <PieChart>
          <Pie
            data={shown}
            dataKey="value"
            innerRadius={46}
            outerRadius={62}
            paddingAngle={shown.filter(part => part.value).length > 1 ? 3 : 0}
            stroke="none"
            isAnimationActive={false}
          >
            {shown.map(part => (
              <Cell key={part.key} fill={part.colour} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className={styles.donutCentre}>
        <strong>{centre}</strong>
        <span>{caption}</span>
      </div>
    </div>
  )
}

// The ring's colours and counts, beside it.
export const Keys = ({ parts }: { parts: Part[] }) => (
  <ul className={styles.keys}>
    {parts.map(part => (
      <li key={part.key}>
        <i style={{ background: part.colour }} />
        <span>{part.name}</span>
        <b>{part.value}</b>
      </li>
    ))}
  </ul>
)

export default Donut
