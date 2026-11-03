import type { LucideIcon } from 'lucide-react'
import { Check } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import styles from './Menu.module.css'

interface MenuProps {
  open: boolean
  // refocus: closed with Escape, so the focus goes back to the button that opened it.
  onClose: (refocus: boolean) => void
  label: string
  // From its wrapper, which is position: relative: under it or above it, from its left edge, its right edge, or as
  // wide as it.
  placement?: 'below' | 'above'
  align?: 'start' | 'end' | 'stretch'
  className?: string
  children: ReactNode
}

const ITEMS = '[role^="menuitem"]:not([aria-disabled="true"])'

// Every drop-down list in Hodi, after the profile selector's: a card of 44 px options with a line between them, the
// chosen one heavier with a check. It closes on a click elsewhere or Escape; up and down go through its options.
const Menu = ({ open, onClose, label, placement = 'below', align = 'start', className, children }: MenuProps) => {
  const panel = useRef<HTMLDivElement>(null)
  // The latest onClose, without opening the effect again on each render.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // Under its button unless that leaves it cut by the bottom of the screen or of a list that scrolls (a source's
  // "⋯" at the end of its group): then above, if there is more room there.
  useLayoutEffect(() => {
    const box = panel.current
    if (!open || !box || placement !== 'below') return
    box.removeAttribute('data-flip')
    let top = 0
    let bottom = window.innerHeight
    for (let parent = box.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowY === 'visible') continue
      const frame = parent.getBoundingClientRect()
      top = Math.max(top, frame.top)
      bottom = Math.min(bottom, frame.bottom)
      break
    }
    const rect = box.getBoundingClientRect()
    const anchor = box.parentElement?.getBoundingClientRect()
    if (rect.bottom > bottom && anchor && anchor.top - top > bottom - anchor.bottom) box.setAttribute('data-flip', '')
  }, [open, placement])

  useEffect(() => {
    if (!open) return
    const wrapper = panel.current?.parentElement
    const away = (event: PointerEvent) => {
      if (!wrapper?.contains(event.target as Node)) close.current(false)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Before a dialog around it hears it.
      event.stopPropagation()
      event.preventDefault()
      close.current(true)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape, true)
    // The chosen option, or the first, takes the focus, so the arrows start there.
    const items = panel.current?.querySelectorAll<HTMLElement>(ITEMS)
    const chosen = panel.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    ;(chosen ?? items?.[0])?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  const keys = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  if (!open) return null
  return (
    <div
      ref={panel}
      role="menu"
      aria-label={label}
      className={`${styles.menu} ${styles[placement]} ${styles[align]} ${className ?? ''}`}
      onKeyDown={keys}
    >
      {children}
    </div>
  )
}

interface MenuItemProps {
  children: ReactNode
  onClick?: () => void
  // A link instead, opened in a new tab (a source's site).
  href?: string
  icon?: LucideIcon
  // An avatar or a topic's square, in place of the icon.
  lead?: ReactNode
  // A choice among others: heavier with a check when it is the one.
  checked?: boolean
  count?: number
  // After the label, before the check: a lock.
  end?: ReactNode
  tone?: 'danger' | 'quiet'
  disabled?: boolean
  label?: string
}

export const MenuItem = ({
  children,
  onClick,
  href,
  icon: Icon,
  lead,
  checked,
  count,
  end,
  tone,
  disabled,
  label
}: MenuItemProps) => {
  const content = (
    <>
      {Icon ? (
        <span className={styles.lead}>
          <Icon size={18} aria-hidden="true" />
        </span>
      ) : (
        lead && <span className={styles.lead}>{lead}</span>
      )}
      <span className={styles.label}>{children}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
      {end}
      {checked && <Check size={16} className={styles.check} aria-hidden="true" />}
    </>
  )
  const className = `${styles.item} ${Icon || lead ? '' : styles.plain} ${tone ? styles[tone] : ''}`
  if (href)
    return (
      <a role="menuitem" className={className} href={href} target="_blank" rel="noreferrer" aria-label={label}>
        {content}
      </a>
    )
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={className}
      onClick={disabled ? undefined : onClick}
    >
      {content}
    </button>
  )
}

export default Menu
