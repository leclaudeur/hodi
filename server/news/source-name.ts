import { decodeEntities } from './text.ts'

// A source's name, from what its feed calls itself. Feed titles are often an address ("https://www.voici.fr : flux
// d'articles"), a label ("Journal des Femmes : Derniers contenus") or a sentence: the site's own name is kept, with
// a short section after it ("Marie Claire Belgique · Beauté"), else the name the site gives itself, else its address.

const MAX_LENGTH = 60
// A section after the name: a word or three ("Beauté", "Sciences et santé"), never a sentence.
const MAX_SECTION_WORDS = 3
const MAX_PART_WORDS = 6

// What says "this is a feed" or "the latest news" rather than who publishes it, in French and English.
const PHRASE =
  /(?:(?:le |les |la |l'|l’)?(?:flux|fil)(?: (?:rss|atom))?(?: (?:d'|d’|de |des )?(?:articles?|actualités?|actus?|infos?|contenus|news))?|rss|atom|feed|(?:les |nos )?derni(?:er|ère)s? (?:contenus|articles|actualités|actus|infos|news|publications)|(?:toute |toutes )?(?:l'|l’|les )?actualités?|actus?|infos?|à la une|une|accueil|home(?: ?page)?|(?:the )?latest(?: (?:news|articles|posts|stories))?|(?:all )?(?:news|articles|posts|stories)|top stories|all(?: content| posts)?|tout|blog)/
    .source
const GENERIC = new RegExp(`^${PHRASE}$`, 'i')
// "Flux d'actualité Elle.fr", "Le Soir fil RSS": the label before the name, or a feed word after it, goes.
const BEFORE = new RegExp(`^${PHRASE}\\s+`, 'i')
const AFTER = /\s+(?:(?:fil|flux) (?:rss|atom)|rss|atom|feed)$/i
// A section is a topic ("Beauté"), not more of the label ("Infos, news & actualités", "All content").
const NOISE = /\b(?:news|infos?|actualités?|actus?|all|content|contenus|articles|posts|rss|feed|flux)\b/i

// A country after the name ("Marie Claire Belgique", "Vogue France", "Elle (Belgique)") says which edition, not who
// publishes: Hodi drops it, unless it is part of the site's own name (radiofrance.fr's "Radio France").
const COUNTRIES =
  /(?:belgique|belgië|belgium|france|suisse|schweiz|switzerland|luxembourg|canada|québec|quebec|maroc|morocco|algérie|tunisie|sénégal|côte d['’]ivoire|afrique|africa|uk|united kingdom|royaume-uni|usa|us|united states|états-unis|ireland|australia|india|germany|deutschland|allemagne|españa|spain|espagne|italia|italy|italie|nederland|pays-bas|be|fr|ch|lu|ca)\b/
    .source
const COUNTRY = new RegExp(`(?:\\s+|\\s*\\(\\s*)${COUNTRIES}(?:\\s*\\))?$`, 'i')
// A section that is only a country ("BBC News - UK").
const ONLY_COUNTRY = new RegExp(`^\\(?${COUNTRIES}\\)?$`, 'i')

const key = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const hostOf = (link: string) => {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

// A feed's own address ("feed.prismamediadigital.com") names its host, not the site.
const ADDRESS = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i

const brandOf = (link: string) => key(hostOf(link).split('.').slice(-2, -1)[0] ?? '')

export const withoutCountry = (name: string, link: string) => {
  const brand = brandOf(link)
  const country = COUNTRY.exec(name)
  if (!country) return name
  const rest = name.slice(0, country.index).replace(/[\s\-–—:|·,]+$/, '')
  // Only the country's words, and only when a name is left and the site's own name does not hold the country.
  return rest && /\p{L}/u.test(rest) && !(brand && brand.includes(key(country[0]))) ? rest : name
}

// The name a page gives its site: <meta property="og:site_name">, else <meta name="application-name">.
export const siteNameOf = (html: string) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\s(?:property|name)\s*=\s*["']?(og:site_name|application-name)["'\s>]/i.exec(tag)?.[1]
    const content = /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)?.slice(1).find(Boolean)
    if (name && content && decodeEntities(content).trim()) return decodeEntities(content).trim().slice(0, MAX_LENGTH)
  }
  return null
}

export const tidySourceName = (title: string, link: string, siteName: string | null = null) => {
  const host = hostOf(link)
  // marieclaire.be gives "marieclaire"; feeds.lesoir.be "lesoir".
  const brand = brandOf(link)
  const isBrand = (text: string) => {
    const part = key(text)
    return brand.length >= 3 && part.length >= 3 && (part.includes(brand) || brand.includes(part))
  }

  const cleaned = title
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = cleaned
    .split(/\s+[-|–—·»:]\s+|\s*[|»]\s*|\s+:\s*|:\s+/)
    .map(part => part.replace(/^[\s\-–—:|·,.]+|[\s\-–—:|·,.…]+$/g, ''))
    .filter(part => part && !GENERIC.test(part))
    .map(part => withoutCountry(part.replace(BEFORE, '').replace(AFTER, '').trim(), link))
    .filter(
      part =>
        part &&
        !GENERIC.test(part) &&
        words(part) <= MAX_PART_WORDS &&
        (!ADDRESS.test(part) || isBrand(part)) &&
        (!ONLY_COUNTRY.test(part) || isBrand(part))
    )

  const named = parts.find(isBrand)
  const sections = parts.filter(
    part => part !== named && words(part) <= MAX_SECTION_WORDS && !isBrand(part) && !NOISE.test(part)
  )
  const section = sections[0]
  const join = (name: string) => (section && key(section) !== key(name) ? `${name} · ${section}` : name)

  const name = named
    ? join(named)
    : siteName
      ? join(withoutCountry(siteName, link))
      : parts.length > 0 && words(parts.join(' ')) <= MAX_PART_WORDS
        ? parts.join(' · ')
        : host
  return (name || host || title).slice(0, MAX_LENGTH)
}

export const isAddressName = (name: string) => ADDRESS.test(name)

// A source named after its address ("voici.fr") takes the name its home page gives the site, once Hodi has read
// that page (for the icon). Null when the page gives none, or only an address.
export const nameFromSite = (current: string, link: string, siteName: string | null) => {
  if (!ADDRESS.test(current) || !siteName) return null
  const name = tidySourceName(siteName, link)
  return ADDRESS.test(name) || name === current ? null : name
}
