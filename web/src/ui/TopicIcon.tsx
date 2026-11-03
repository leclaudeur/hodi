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
  belgique: Landmark,
  monde: Globe,
  tech: Cpu,
  science: FlaskConical,
  'films-series': Clapperboard,
  'jeux-video': Gamepad2,
  ia: Bot,
  broadcast: Radio,
  lifestyle: Coffee,
  'auto-moto': Car,
  sport: Trophy,
  'argent-conso': Wallet,
  sante: HeartPulse,
  cuisine: CookingPot,
  voyage: Plane,
  musique: Music,
  culture: Palette,
  'maison-deco': Sofa,
  famille: Baby,
  'mode-beaute': Shirt,
  climat: Leaf,
  animaux: PawPrint
}

// A topic's icon, decorative: the topic's name is always written beside it.
const TopicIcon = ({ topicId, size }: { topicId: string; size: number }) =>
  createElement(ICONS[topicId] ?? Newspaper, { size, 'aria-hidden': true })

export default TopicIcon
