import { createElement } from 'react'
import {
  Baby,
  Bot,
  Car,
  Clapperboard,
  CookingPot,
  Coffee,
  Cpu,
  FlaskConical,
  Gamepad2,
  Globe,
  HeartPulse,
  Landmark,
  Leaf,
  type LucideIcon,
  Music,
  Newspaper,
  Palette,
  PawPrint,
  Plane,
  Radio,
  Shirt,
  Sofa,
  Trophy,
  Wallet
} from 'lucide-react'

// Each topic's icon (the charter's), shown with its colour (styles/tokens.css, data-topic).
const ICONS: Record<string, LucideIcon> = {
  belgium: Landmark,
  world: Globe,
  tech: Cpu,
  science: FlaskConical,
  'film-tv': Clapperboard,
  gaming: Gamepad2,
  ai: Bot,
  broadcast: Radio,
  lifestyle: Coffee,
  motoring: Car,
  sport: Trophy,
  money: Wallet,
  health: HeartPulse,
  food: CookingPot,
  travel: Plane,
  music: Music,
  culture: Palette,
  home: Sofa,
  family: Baby,
  fashion: Shirt,
  climate: Leaf,
  animals: PawPrint
}

// A topic's icon, decorative: the topic's name is always written beside it.
const TopicIcon = ({ topicId, size }: { topicId: string; size: number }) =>
  createElement(ICONS[topicId] ?? Newspaper, { size, 'aria-hidden': true })

export default TopicIcon
