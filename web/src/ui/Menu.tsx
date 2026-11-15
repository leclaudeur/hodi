import type { LucideIcon } from 'lucide-react'
import { Check } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef } from 'react'
import type { ReferenceType } from '@floating-ui/react-dom'
import { useFloatingPanel } from '../lib/floating.ts'
import styles from './Menu.module.css'

interface MenuProps {
  open: boolean
  // refocus: closed with Escape, so the focus goes back to the button that opened it.
  onClose: (refocus: boolean) => void
  label: string
  // From its wrapper (or anchor): under it or above it, from its left edge, its right edge, or as wide as it. It
  // turns to the other side when there is more room there.
  placement?: 'below' | 'above'
  align?: 'start' | 'end' | 'stretch'
  // What it opens from, when wider than its wrapper (the profile selector's whole row).
  anchor?: (wrapper: HTMLElement) => ReferenceType
  className?: string
  children: ReactNode
}

const ITEMS = '[role^="menuitem"]:not([aria-disabled="true"])'

// Every drop-down list in Hodi, after the profile selector's: a card of 44 px options with a line between them, the
// chosen one heavier with a check. It closes on a click elsewhere or Escape; up and down go through its options.
const Menu = ({
  open,
  onClose,
  label,
  placement = 'below',
  align = 'start',
  anchor,
  className,
  children
}: MenuProps) => {
  const panel = useRef<HTMLDivElement>(null)
  const floating = useFloatingPanel(open, {
    placement: `${placement === 'below' ? 'bottom' : 'top'}${align === 'end' ? '-end' : align === 'start' ? '-start' : ''}`,
    stretch: align === 'stretch',
    maxHeight: 360,
    anchor
  })
  const { attach: place } = floating
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      panel.current = node
      place(node)
    },
    [place]
  )
  // The latest onClose, without opening the effect again on each render.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

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
      ref={ref}
      popover="manual"
      style={floating.style}
      role="menu"
      aria-label={label}
      className={`${styles.menu} ${align === 'stretch' ? styles.stretch : ''} ${className ?? ''}`}
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

// A line between groups of options (the profiles, then the plugins' entries).
export const MenuSeparator = () => <div role="separator" className={styles.separator} />

export default Menu
