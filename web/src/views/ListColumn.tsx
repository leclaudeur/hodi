import { type ReactNode, useLayoutEffect, useRef } from 'react'
import ScrollArea from '../ui/ScrollArea.tsx'
import styles from './ListColumn.module.css'

interface ListColumnProps {
  title: string
  // "64 ARTICLES · 3 JOURS".
  meta?: string
  children: ReactNode
  // Pinned under the list: "Charger <jour>".
  footer?: ReactNode
  busy?: boolean
  // Held under the header while the list scrolls: À la une's stories, a filter row. It draws its own line under it.
  pinned?: ReactNode
  // Right after the title: its "?".
  help?: ReactNode
}

// The desktop list, between the sidebar and the reader, a 2px line under its header. Only the list scrolls: the
// header (and what is pinned under it) stays.
const ListColumn = ({ title, meta, children, footer, busy = false, pinned, help }: ListColumnProps) => {
  const column = useRef<HTMLElement>(null)

  // How far the list starts under the column's top: an empty state moves up by half of it, so it sits at the
  // column's middle, level with the empty reader beside it.
  useLayoutEffect(() => {
    const element = column.current
    const scroll = element?.querySelector<HTMLElement>(`.${styles.scroll}`)
    if (!element || !scroll) return
    const measure = () => element.style.setProperty('--list-top', `${scroll.offsetTop}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={column} className={styles.column} aria-label={title} aria-busy={busy}>
      <div className={styles.header}>
        <h1 className={`${styles.title} screen-title`}>{title}</h1>
        {help}
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>
      <div className={styles.line} aria-hidden="true" />
      {pinned && <div className={styles.pinned}>{pinned}</div>}
      <ScrollArea className={styles.scroll}>
        <div className={styles.content} data-list-column="">
          {children}
          {footer && <div className={styles.spacer} aria-hidden="true" />}
        </div>
      </ScrollArea>
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  )
}

export default ListColumn
