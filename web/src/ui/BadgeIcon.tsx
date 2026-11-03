import {
  CalendarHeart,
  Earth,
  Heart,
  Library,
  type LucideIcon,
  Mailbox,
  MoonStar,
  ScanSearch,
  Shapes,
  Sunrise,
  Users
} from 'lucide-react'
import type { BadgeId } from '../api.ts'

// The game's badges, from Lucide like every other icon of the app. None is used elsewhere for something else, so that
// a badge is never read as an action (Facteur is not Share's paper plane).
const ICONS: Record<BadgeId, LucideIcon> = {
  'early-bird': Sunrise,
  'night-owl': MoonStar,
  faithful: CalendarHeart,
  globetrotter: Earth,
  'all-rounder': Shapes,
  postman: Mailbox,
  'crowd-pleaser': Heart,
  sleuth: ScanSearch,
  encyclopedia: Library,
  'team-player': Users
}

// Some drawings are not centred in Lucide's 24 grid (Oiseau de nuit's star sticks out on the right): moved by half a
// unit, in 24ths of the icon, so that every badge sits in the middle of its round or square.
const OFFSETS: Partial<Record<BadgeId, [number, number]>> = {
  'night-owl': [-0.5, 0],
  faithful: [-0.5, 0.5],
  'all-rounder': [0, 0.18],
  'crowd-pleaser': [0, -0.5]
}

const BadgeIcon = ({ id, size = 18 }: { id: BadgeId; size?: number }) => {
  const Icon = ICONS[id]
  const [x, y] = OFFSETS[id] ?? [0, 0]
  return (
    <Icon
      size={size}
      strokeWidth={2}
      aria-hidden="true"
      style={x || y ? { translate: `${(x / 24) * 100}% ${(y / 24) * 100}%` } : undefined}
    />
  )
}

export default BadgeIcon
