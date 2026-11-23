import { KeyRound, Puzzle, Rss } from 'lucide-react'
import type { InboxKind } from '../../../lib/server-inbox.ts'

const ICONS = { source: Rss, code: KeyRound, plugin: Puzzle }

// An item's kind at a glance, in its tile.
const InboxIcon = ({ kind, size = 20 }: { kind: InboxKind; size?: number }) => {
  const Icon = ICONS[kind]
  return <Icon size={size} aria-hidden="true" />
}

export default InboxIcon
