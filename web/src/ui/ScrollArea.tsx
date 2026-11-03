import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import type { HTMLAttributes, ReactNode } from 'react'

// A region that scrolls on its own (a desktop column), with floating scrollbars.
// With a finger, the system's own floating scrollbar is used: nothing to run, nothing to draw.
const finePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

const OPTIONS = {
  scrollbars: { theme: 'os-theme-hodi', autoHide: 'scroll', autoHideDelay: 800 },
  overflow: { x: 'hidden' }
} as const

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  // The element that actually scrolls, once there: to read or set where it is scrolled to.
  onViewport?: (viewport: HTMLElement | null) => void
}

const ScrollArea = ({ children, style, onViewport, ...props }: ScrollAreaProps) =>
  finePointer ? (
    // defer: set up when the browser is idle, so the first paint is not delayed.
    <OverlayScrollbarsComponent
      element="div"
      options={OPTIONS}
      defer
      style={style}
      events={onViewport && { initialized: instance => onViewport(instance.elements().viewport) }}
      {...props}
    >
      {children}
    </OverlayScrollbarsComponent>
  ) : (
    <div ref={onViewport} style={{ overflowY: 'auto', overflowX: 'hidden', ...style }} {...props}>
      {children}
    </div>
  )

export default ScrollArea
