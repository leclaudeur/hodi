import {
  autoUpdate,
  flip,
  offset,
  type Placement,
  type ReferenceType,
  shift,
  size,
  useFloating
} from '@floating-ui/react-dom'
import { type CSSProperties, useCallback } from 'react'

interface FloatingOptions {
  placement?: Placement
  // As wide as what it opens from (a field's suggestions).
  stretch?: boolean
  // Its tallest, when the screen has room for it.
  maxHeight?: number
  gap?: number
  // Moved along its side, from its start (a help bubble's tip under its button).
  cross?: number
  // What it opens from: its wrapper (the element it is in) by default, or a box around more than it.
  anchor?: (wrapper: HTMLElement) => ReferenceType
}

const MARGIN = 8
// Its shortest, about two options and a half: with less room than this on either side, it covers what it opens from.
const MIN_HEIGHT = 120

// Every drop-down and bubble that opens from a control: shown in the browser's top layer (popover="manual"), so
// that no dialog or list that scrolls cuts it, and placed by Floating UI beside what it opens from. It turns to the
// other side when there is more room there, is never taller than the room left (its list scrolls) and follows a
// scroll. With too little room both above and below, it keeps a usable height and slides over what it opens from
// rather than off the screen.
// attach goes on the panel's ref, with popover="manual", and style on its style.
export const useFloatingPanel = (
  open: boolean,
  { placement = 'bottom-start', stretch = false, maxHeight, gap = 6, cross = 0, anchor }: FloatingOptions = {}
) => {
  const { refs, floatingStyles, isPositioned } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    // top and left rather than a transform, which the panels' own entrance animations use.
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset({ mainAxis: gap, crossAxis: cross }),
      flip({ padding: MARGIN }),
      size({
        padding: MARGIN,
        apply({ availableHeight, rects, elements }) {
          const screen = window.innerHeight - 2 * MARGIN
          const room = Math.min(screen, Math.max(MIN_HEIGHT, availableHeight))
          elements.floating.style.maxHeight = `${maxHeight ? Math.min(maxHeight, room) : room}px`
          if (stretch) elements.floating.style.width = `${rects.reference.width}px`
        }
      }),
      // Last, on the size it now has: back on the screen across too, over its field if it must.
      shift({ padding: MARGIN, crossAxis: true })
    ]
  })
  const { setFloating, setReference } = refs

  const ref = useCallback(
    (panel: HTMLElement | null) => {
      setFloating(panel)
      if (!panel) return
      const wrapper = panel.parentElement
      if (wrapper) setReference(anchor ? anchor(wrapper) : wrapper)
      // Above everything, the modal dialog it may be in too.
      if (!panel.matches(':popover-open')) panel.showPopover?.()
    },
    [setFloating, setReference, anchor]
  )

  // Unseen until placed, not a frame in the corner.
  const style: CSSProperties = { ...floatingStyles, visibility: isPositioned ? undefined : 'hidden' }
  return { attach: ref, style }
}
