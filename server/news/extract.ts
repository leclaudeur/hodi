import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

export interface ExtractedArticle {
  title: string | null
  byline: string | null
  contentHtml: string
  textLength: number
  // The page's share image (og:image), for feeds that carry no usable image.
  image: string | null
}

const shareImage = (document: ReturnType<typeof parseHTML>['document'], url: string) => {
  const content = document
    .querySelector('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]')
    ?.getAttribute('content')

  try {
    const image = content ? new URL(content.trim(), url) : null
    return image?.protocol === 'https:' ? image.toString() : null
  } catch {
    return null
  }
}

type Element = ReturnType<ReturnType<typeof parseHTML>['document']['createElement']>
type TextNode = ReturnType<ReturnType<typeof parseHTML>['document']['createTextNode']>

const normalizedText = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
const normalized = (value: string | null | undefined) => normalizedText(value).toLowerCase()

// Site furniture Readability keeps around the text (RTL info): bylines with "add us to
// your Google favorites" and the author's photo, link lists such as "À la une", logos.
const NOISE_TEXT = /ajoutez-nous à vos favoris google|^par .{0,80}publié le \d{1,2} \S+ (\d{4} )?à \d{1,2}h\d{2}/i
const LINK_LIST_HEADING =
  /^(à|a) la une|^(à )?lire aussi|^sur le même sujet|^dans l'actualité|^nos autres (guides|articles|dossiers)|^(à )?voir aussi|^pour aller plus loin|^related( articles| stories)?$|^more from|^sur le même thème|^vous aimerez aussi|^d['’]autres actualités|^les plus lus|^most (read|popular)$|^articles connexes|^related content/i
// "À lire aussi : <link>", in a paragraph or a quote of its own, in the middle of the text.
const READ_ALSO =
  /^((à )?lire aussi|(à )?voir aussi|à découvrir|sur le même sujet|read (more|also)|see also|related)\s*:?/i
const MAX_READ_ALSO_LENGTH = 300
// Everything from this heading on is the site's footer: sponsored links, more articles, tags.
const FOOTER_HEADING =
  /^contenus? sponsorisés?|^contenus? partenaires?|^sponsorisé\s*:?$|^commentaires?$|^comments?$|^mots-clés( associés)?$|^tags?\s*:?$|^sources?\s*:?$|^à propos de l['’]auteur$|^about the author$|^(ses|ces) derniers articles$|^du même auteur$|^(more|latest) (stories |articles )?(from|by) (this|the) author$|^who['’]s behind this story\??$|^ça vous a intéressé|^(les? |la )?(jeux?|sociétés?|articles?|tests?) en rapport$|^vidéo du moment$/i
// What a site shows in place of an embed (a tweet, a video) until its cookies are accepted, and its
// prompts to install it or read it elsewhere: nothing of the article.
const PLACEHOLDER_TEXT = new RegExp(
  [
    'ce contenu est bloqué car vous n.avez pas accepté les cookies',
    'en cliquant sur « j.accepte tout »',
    'vous gardez la possibilité de retirer votre consentement',
    'pour afficher ce contenu .{0,40}, (il est nécessaire|vous devez) (d.autoriser|accepter)',
    'une extension de votre navigateur semble bloquer',
    'ajoutez .{0,40} à votre écran d.accueil',
    '^(toute l.actu .{0,30} en un clin d.(œ|oe)il)$',
    '^temps de lecture\\s*:?\\s*\\d+\\s*min',
    '^\\d+\\s*min(utes)? (de lecture|read)$',
    '^\\d+\\s*min(utes)? temps de lecture$',
    '^(contenu vidéo|a retrouver dans l.émission)',
    // A gallery's count, left once its slideshow went: "13 images" (Gamekult).
    '^\\d+ (images|photos)$',
    // A rating widget, a cookie or ad-blocker wall and a subscriber-only feature, left as text.
    '^(as-tu|avez-vous) apprécié (cet|l.) ?article',
    '^you rated this article',
    '^(what do you think so far|was this (article |page )?helpful|did you (like|enjoy) this (article|story))\\s*\\??$',
    'vous avez choisi de ne pas accepter le dépôt de',
    '^pourquoi voyez-vous ce message',
    'désactivez votre bloqueur de publicité',
    'fonctionnalité est r[ée]serv[ée]e aux abonnés',
    '^soutenez .{0,40} sans publicité',
    '^(skip past|after) newsletter promotion$'
  ].join('|'),
  'i'
)
// What an embed shows while its script loads, which never runs here: "Chargement du twitt…" (Konbini).
const LOADING_TEXT = /^(chargement|loading)( d(u|e la|e l.|es))?\s*[\p{L}' ]{0,30}?\s*(…|\.{3})?$/iu
const MAX_LOADING_LENGTH = 50
// Below this, an image is an icon or a logo: a network's, an app's, a sharing button's.
const MAX_ICON_SIZE = 100
// After the last rule of the page, less than this is footer: share buttons, a newsletter prompt.
const MAX_TRAILING_TEXT = 250
// A list of short items, as the games of a bundle: shown in columns.
const MIN_COMPACT_ITEMS = 8
const MAX_COMPACT_ITEM_LENGTH = 50
// A caption that is only a credit: "©Gameblog", "Crédit : AFP".
const CREDIT_ONLY = /^(©|\(c\)|crédits?\s*:|credits?\s*:|source\s*:|photo\s*:)/i
const MAX_CREDIT_LENGTH = 80
// Bylines are often spans and links, not blocks: they are looked for too.
const NOISE_CANDIDATES = 'span, a, em, time, small'
const SMALL_BLOCK = 300
const BLOCKS = 'p, div, section, aside, header, footer, figure, ul, ol, li, h1, h2, h3, h4, h5, h6, blockquote'
const TEXT_BLOCKS = 'p, h2, h3, h4, h5, h6, blockquote, li'
const MIN_DUPLICATE_LENGTH = 60
// Furniture any site can leave around the text, in French or English; the reader shows the source,
// the author and the date already.
// A byline on its own: "par Louis Vandendriessche", "By Jane Doe".
const BYLINE_ONLY = /^(par|by)\s+\S.{0,60}$/i
// "Publié le 25 octobre à 09h06", "Publié le 25/10/2026 - 16:49 UTC+1" (Euronews),
// "Published Oct 25, 2026, 5:26 AM EDT", "Updated: October 25, 2026".
const DATE_LINE = new RegExp(
  [
    '^(publié|mis à jour|actualisé|modifié)\\s+le\\s*:?\\s*(\\d{1,2}\\s+\\S+(\\s+\\d{4})?|\\d{1,2}/\\d{1,2}/\\d{2,4})' +
      '(\\s*(à|-|–|,)?\\s*\\d{1,2}[h:]\\d{2}(\\s*(utc|gmt)\\s*[+-]?\\s*\\d{0,2}|\\s*(cet|cest))?)?',
    '^(published|updated|posted)(\\s+on)?:?\\s+[a-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4}' +
      '(,?\\s+(at\\s+)?\\d{1,2}:\\d{2}(\\s*[ap]\\.?m\\.?)?(\\s+[a-z]{2,4})?)?',
    // "Création du dossier : 10 mars 2026", "Dernière mise à jour : 31 octobre 2026", "Last updated: 31 October 2026".
    '^(création( du dossier)?|(dernière )?mise à jour|last updated|created)\\s*:?\\s*(le\\s+)?\\d{1,2}(er)?\\s+\\S+\\s+\\d{4}'
  ].join('|'),
  'i'
)
// Account and subscription prompts: "Sign in to your Collider account", "Abonnez-vous à la newsletter".
const ACCOUNT_PROMPT =
  /^(sign in|log in|sign up|subscribe|create (a|an|your) .{0,20}account|se connecter|connectez-vous|s'abonner|abonnez-vous|inscrivez-vous|créer un compte)\b/i
const MAX_PROMPT_LENGTH = 80
const LIVE_STATUS = /^(en cours|en direct|direct|live|terminé|ended|direct terminé|live ended)$/i
// An ad slot's label and a share button's, left as text: "Publicité, votre contenu continue ci-dessous", "Partager".
const SLOT_LABEL =
  /^(publicité|espace publicitaire|advertisement|annonce)(\s*[,:–-].{0,40})?$|^(partager|partagez|share)( (cet|l['’])article| this( article)?)?$/i
// An author's bio: "Lucas Kloberdanz-Dyck is a writer for Collider…", "Marie Dupont est journaliste…".
const AUTHOR_BIO =
  /^(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,3})\s+(?:is|est)\s+(?:a|an|the|un|une|le|la|l’|l')?\s*[^.]{0,60}?(?:writer|editor|journalist|reporter|contributor|critic|correspondent|journaliste|rédact|correspondant|critique|chroniqu|pigiste)/u
// The same bio when the name is in the block before it: "is a senior reporter covering technology…".
const AUTHOR_BIO_TAIL =
  /^(is|est)\s+(a|an|the|un|une|le|la|l’|l')?\s*[^.]{0,60}?(writer|editor|journalist|reporter|contributor|critic|correspondent|journaliste|rédact|correspondant|critique|chroniqu|pigiste)/u
const MAX_NAME_LENGTH = 40
const MAX_BIO_LENGTH = 700
// Author photos: their alt is the author's name, or their path says what they are.
const AUTHOR_IMAGE = /\/(auteurs?|authors?|avatars?|profiles?)\//i
const AUTHOR_PAGE = /\/(auteurs?|authors?|journalistes?|redacteurs?)\//i

const linkTextRatio = (element: Element) => {
  const total = normalized(element.textContent).length
  const linked = [...element.querySelectorAll('a')].reduce(
    (length, link) => length + normalized(link.textContent).length,
    0
  )
  return total === 0 ? 0 : linked / total
}

// The largest small block around an element, so the whole byline goes, not one line of it.
const smallestEnclosingBlock = (element: Element, root: Element) => {
  let block: Element = element

  while (
    block.parentElement &&
    block.parentElement !== root &&
    normalized(block.parentElement.textContent).length <= SMALL_BLOCK
  ) {
    block = block.parentElement
  }

  return block
}

// The element with its wrappers: the outermost ancestor holding nothing more than it.
const withWrappers = (element: Element, root: Element) => {
  let block = element
  const text = normalized(element.textContent)
  while (block.parentElement && block.parentElement !== root && normalized(block.parentElement.textContent) === text) {
    block = block.parentElement
  }
  return block
}

// The first piece of text in an element, skipping empty ones.
const firstTextNode = (element: Element): TextNode | null => {
  for (const child of [...element.childNodes]) {
    if (child.nodeType === 3) {
      if ((child.textContent ?? '').trim() !== '') return child as unknown as TextNode
    } else if (child.nodeType === 1) {
      const found = firstTextNode(child as unknown as Element)
      if (found) return found
      if (normalized(child.textContent) !== '') return null
    }
  }
  return null
}

// Bylines, date lines, author bios with their photo and account prompts, wherever they sit and
// whatever the source; a date line run into the lead is cut from it.
const removeBylines = (root: Element) => {
  const names = new Set<string>()

  // The block, and an image-only block right before it: the author's photo.
  const removeWithPhoto = (block: Element) => {
    const previous = block.previousElementSibling
    if (previous && normalized(previous.textContent) === '' && previous.matches('img, picture, figure, div, p, span'))
      if (previous.matches('img') || previous.querySelector('img')) previous.remove()
    if (block.nextElementSibling?.tagName === 'BR') block.nextElementSibling.remove()
    block.remove()
  }

  for (const element of [...root.querySelectorAll(`${BLOCKS}, ${NOISE_CANDIDATES}`)]) {
    if (!element.isConnected) continue
    const raw = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    const text = raw.toLowerCase()

    if (BYLINE_ONLY.test(text) && !text.includes('. ')) {
      names.add(text.replace(/^(par|by)\s+/, ''))
      removeWithPhoto(withWrappers(element, root))
      continue
    }

    // A block holding only a link to the author's page: a byline without its "par" (ActuGaming).
    const link = element.matches(TEXT_BLOCKS) ? element.querySelector('a') : null
    if (
      link &&
      text !== '' &&
      text.length <= MAX_NAME_LENGTH &&
      normalized(link.textContent).toLowerCase() === text &&
      AUTHOR_PAGE.test(link.getAttribute('href') ?? '')
    ) {
      names.add(text)
      removeWithPhoto(withWrappers(element, root))
      continue
    }

    // A block holding only a <time>: the page's own date line, whatever its format.
    const time = element.querySelector('time')
    if (time && normalized(time.textContent) === text && text !== '') {
      removeWithPhoto(withWrappers(element, root))
      continue
    }

    const date = text.match(DATE_LINE)
    if (date && date[0].length === text.length) {
      removeWithPhoto(withWrappers(element, root))
      continue
    }

    // A live page's status ("En cours", "Live") and a label left with nothing after it ("Animé par :").
    const next = withWrappers(element, root).nextElementSibling
    if (
      element.matches(TEXT_BLOCKS) &&
      (LIVE_STATUS.test(text) ||
        (text.length <= MAX_NAME_LENGTH && text.endsWith(':') && (!next || next.matches('h2, h3, h4, h5, h6, hr'))))
    ) {
      withWrappers(element, root).remove()
      continue
    }

    if (element.matches(TEXT_BLOCKS) && SLOT_LABEL.test(text)) {
      withWrappers(element, root).remove()
      continue
    }

    if (text.length <= MAX_PROMPT_LENGTH && ACCOUNT_PROMPT.test(text)) {
      withWrappers(element, root).remove()
      continue
    }

    const bio = element.matches(TEXT_BLOCKS) && text.length <= MAX_BIO_LENGTH ? AUTHOR_BIO.exec(raw) : null
    if (bio?.[1]) {
      names.add(bio[1].toLowerCase())
      removeWithPhoto(withWrappers(element, root))
    }

    if (element.matches(TEXT_BLOCKS) && text.length <= MAX_BIO_LENGTH && AUTHOR_BIO_TAIL.test(raw)) {
      const block = withWrappers(element, root)
      const name = block.previousElementSibling
      const nameText = normalized(name?.textContent)
      if (name && nameText.length > 0 && nameText.length <= MAX_NAME_LENGTH && !nameText.includes('.')) {
        names.add(nameText)
        removeWithPhoto(name)
      }
      block.remove()
    }
  }

  // The date line in front of the lead, in the same paragraph.
  for (const block of [...root.querySelectorAll(TEXT_BLOCKS)]) {
    const node = firstTextNode(block)
    const value = node?.textContent ?? ''
    const date = value.trimStart().match(DATE_LINE)
    if (node && date) node.textContent = value.trimStart().slice(date[0].length).trimStart()
  }

  for (const image of [...root.querySelectorAll('img')]) {
    const alt = normalized(image.getAttribute('alt'))
    if ((alt && names.has(alt)) || AUTHOR_IMAGE.test(image.getAttribute('src') ?? '')) {
      withWrappers(image, root).remove()
    }
  }
}

const MEDIA = 'img, picture, video, iframe, hr'

// Lazy images keep their address in data-src until a script swaps it in: the script never runs here.
const LAZY_SOURCES = ['data-src', 'data-lazy-src', 'data-original', 'data-orig-file']
const LAZY_SETS = ['data-srcset', 'data-lazy-srcset']
const showLazyImages = (document: ReturnType<typeof parseHTML>['document']) => {
  for (const element of [...document.querySelectorAll('img, source')]) {
    const src = element.getAttribute('src') ?? ''
    const lazy = LAZY_SOURCES.map(name => element.getAttribute(name)).find(Boolean)
    if (lazy && (src === '' || src.startsWith('data:'))) element.setAttribute('src', lazy)
    const set = LAZY_SETS.map(name => element.getAttribute(name)).find(Boolean)
    if (set && !element.getAttribute('srcset')) element.setAttribute('srcset', set)
  }
}

// Images that show nothing (still a placeholder) or only an icon: a network's, an app's.
const removeEmptyImages = (root: Element) => {
  for (const image of [...root.querySelectorAll('img')]) {
    const src = image.getAttribute('src') ?? ''
    const width = Number(image.getAttribute('width'))
    const height = Number(image.getAttribute('height'))
    const icon = width > 0 && height > 0 && width <= MAX_ICON_SIZE && height <= MAX_ICON_SIZE
    if (!src || src.startsWith('data:') || icon) (image.closest('picture') ?? image).remove()
  }
}

// Captions: one that is only a credit goes; the credit after "//" ("Le président // Source : …")
// is set apart, in small type.
const tidyCaptions = (root: Element) => {
  for (const caption of [...root.querySelectorAll('figcaption')]) {
    const text = normalized(caption.textContent)
    const figure = caption.closest('figure')
    // Its picture gone: nothing left to caption.
    if (figure && !figure.querySelector(MEDIA)) {
      figure.remove()
      continue
    }
    if (text === '' || (text.length <= MAX_CREDIT_LENGTH && CREDIT_ONLY.test(text))) {
      caption.remove()
      continue
    }
    const node = [...caption.childNodes].find(child => child.nodeType === 3 && (child.textContent ?? '').includes('//'))
    if (!node) continue
    const [before = '', ...after] = (node.textContent ?? '').split('//')
    const credit = caption.ownerDocument.createElement('small')
    credit.append(`${after.join('//').trim()}${node.nextSibling ? ' ' : ''}`)
    while (node.nextSibling) credit.append(node.nextSibling)
    node.textContent = before.trimEnd()
    caption.append(credit)
  }
}

// An embedded post (a tweet) stays as its text, marked for the reader to show it as a card rather than
// as the article's own pull quote; its picture link, "pic.twitter.com/…", goes.
const EMBED_LINK =
  /^https:\/\/(www\.)?(x|twitter|bsky|mastodon|threads|instagram|tiktok)\.[a-z.]+\/.*\/(status|post|p|reel|video)\//i
const networkOf = (href: string) => {
  const host = new URL(href).hostname.replace(/^www\./, '')
  if (/^(x|twitter)\.com$/.test(host)) return 'x'
  if (/instagram\.com$/.test(host)) return 'instagram'
  if (/bsky\.app$/.test(host)) return 'bluesky'
  if (/threads\.(net|com)$/.test(host)) return 'threads'
  if (/tiktok\.com$/.test(host)) return 'tiktok'
  return 'mastodon'
}

// "— Jane Doe (@jane) October 30, 2026" under an embedded post: the author goes to the top of the card,
// the date to its foot, as the network shows them.
const ATTRIBUTION = /^[—–-]\s*(.+?)\s*\((@[\w.@-]+)\)\s*$/u

const moveAttribution = (quote: Element) => {
  const date = [...quote.querySelectorAll('a')].pop()
  const before = date?.previousSibling
  const match = before?.nodeType === 3 ? ATTRIBUTION.exec((before.textContent ?? '').trim()) : null
  if (!date || !before || !match) return
  const [, name = '', handle = ''] = match
  const document = quote.ownerDocument
  const holder = date.parentElement

  const author = document.createElement('p')
  author.setAttribute('data-embed-author', '')
  const strong = document.createElement('strong')
  strong.textContent = name
  const span = document.createElement('span')
  span.textContent = handle
  author.append(strong, span)

  const foot = document.createElement('p')
  foot.setAttribute('data-embed-date', '')
  foot.textContent = normalizedText(date.textContent)

  before.remove()
  date.remove()
  if (holder && holder !== quote && normalized(holder.textContent) === '') holder.remove()
  quote.prepend(author)
  quote.append(foot)
}

const markEmbeds = (root: Element) => {
  for (const link of [...root.querySelectorAll('a')]) {
    if (/^pic\.(twitter|x)\.com\//i.test(normalized(link.textContent))) link.remove()
  }
  for (const quote of [...root.querySelectorAll('blockquote')]) {
    const links = [...quote.querySelectorAll('a')].map(link => link.getAttribute('href') ?? '')
    const post = links.find(href => EMBED_LINK.test(href))
    if (!post) continue
    quote.setAttribute('data-embed', '')
    // The network, for the card's logo and its "Voir sur …" link.
    quote.setAttribute('data-network', networkOf(post))
    quote.setAttribute('data-href', post)
    moveAttribution(quote)
  }
}

// Embedded players and frames never run in the reader. A YouTube video becomes a card: its thumbnail (YouTube's
// public image address) and a link to watch it there. Anything else (a podcast player, an ad) goes, with the
// figure or wrapper that held only it and its caption.
const FRAMES = 'iframe, embed, object, video, audio'
const YOUTUBE_EMBED = /^(?:https?:)?\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/i
const GENERIC_FRAME_TITLE = /^(youtube( video)? player|lecteur vidéo youtube|vidéo youtube|embedded content)$/i

const youtubeCard = (frame: Element, videoId: string) => {
  const document = frame.ownerDocument
  const card = document.createElement('a')
  card.setAttribute('href', `https://www.youtube.com/watch?v=${videoId}`)
  card.setAttribute('data-embed-card', 'youtube')
  const image = document.createElement('img')
  image.setAttribute('src', `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)
  image.setAttribute('alt', '')
  card.append(image)
  const title = normalizedText(frame.getAttribute('title'))
  if (title && !GENERIC_FRAME_TITLE.test(title)) {
    const label = document.createElement('span')
    label.textContent = title
    card.append(label)
  }
  return card
}

const replaceFrames = (root: Element) => {
  for (const frame of [...root.querySelectorAll(FRAMES)]) {
    if (!frame.isConnected) continue
    const videoId = YOUTUBE_EMBED.exec(frame.getAttribute('src') ?? frame.getAttribute('data-src') ?? '')?.[1]
    const figure = frame.closest('figure')
    const holder = figure && !figure.querySelector('img') ? figure : withWrappers(frame, root)
    if (videoId) holder.replaceWith(youtubeCard(frame, videoId))
    else holder.remove()
  }
}

// An embedded post whose text did not come through (only its link or date) shows nothing worth a card.
const MIN_EMBED_TEXT = 20
const removeEmptyEmbeds = (root: Element) => {
  for (const quote of [...root.querySelectorAll('blockquote[data-embed]')]) {
    const text = normalized(
      [...quote.childNodes]
        .filter(node => node.nodeType !== 1 || (node as unknown as Element).tagName !== 'A')
        .map(node => node.textContent)
        .join(' ')
    )
    if (text.replace(/[—–-]\s*\S+\s*\(@\w+\).*$/, '').length < MIN_EMBED_TEXT) quote.remove()
  }
}

// One caption style whatever the site: its text on one line, without its own formatting, icons or paragraphs,
// and its credit ("© AFP", "Photo : Belga") set apart. A caption that repeats the one before goes (RTL info).
const CREDIT_TAIL =
  /\s*(?:[|/—–-]\s*)?((?:©|\(c\)|crédits?\s*:|credits?\s*:|photo(?:graph)?\s*:|illustration\s*:|source\s*:|image\s*:)\s*[^©]{1,80})$/i
const flattenCaptions = (root: Element) => {
  let previous = ''
  for (const caption of [...root.querySelectorAll('figcaption')]) {
    // A credit the site set apart already (tidyCaptions) keeps its link.
    const credit = caption.querySelector('small')
    credit?.remove()
    for (const icon of [...caption.querySelectorAll('svg, img, picture, button')]) icon.remove()
    let text = normalizedText(caption.textContent)
    let tail: string | null = null
    const match = credit ? null : text.match(CREDIT_TAIL)
    if (match?.[1] && match.index && match.index > 0) {
      tail = match[1].trim()
      text = text.slice(0, match.index).trim()
    }
    if (text.toLowerCase() === previous && !credit && !tail) {
      caption.remove()
      continue
    }
    previous = text.toLowerCase()
    caption.textContent = text
    if (credit) caption.append(credit)
    else if (tail) {
      const small = caption.ownerDocument.createElement('small')
      small.textContent = tail
      caption.append(small)
    }
  }
}

// Pictures one after the other, with no text between them, become one group: the reader lays out small ones in
// a grid and stacks large ones.
const isPictureBlock = (element: Element) =>
  element.querySelector('img') !== null &&
  normalized(
    [...element.childNodes]
      .filter(node => (node as unknown as Element).tagName !== 'FIGCAPTION')
      .map(node => node.textContent)
      .join(' ')
  ) === '' &&
  !element.querySelector(TEXT_BLOCKS)

const groupPictures = (root: Element) => {
  for (const parent of [root, ...root.querySelectorAll('div, section, article')]) {
    const children = [...parent.children]
    let run: Element[] = []
    const flush = () => {
      if (run.length >= 2) {
        const group = parent.ownerDocument.createElement('div')
        group.setAttribute('data-gallery', '')
        run[0]?.before(group)
        for (const item of run) group.append(item)
      }
      run = []
    }
    for (const child of children) {
      if (child.matches('[data-gallery]')) {
        flush()
        continue
      }
      if (child.matches('figure, picture, img, p, div') && isPictureBlock(child)) run.push(child)
      else flush()
    }
    flush()
  }
}

// After the last rule, a few words only: share buttons, a newsletter prompt.
const removeTrailingRule = (root: Element) => {
  const rules = [...root.querySelectorAll('hr')]
  const last = rules.at(-1)
  if (!last) return
  let after = ''
  for (let node: Element | null = last; node && node !== root; node = node.parentElement) {
    for (let next = node.nextElementSibling; next; next = next.nextElementSibling) after += ` ${next.textContent ?? ''}`
  }
  if (normalized(after).length < MAX_TRAILING_TEXT) removeFrom(last, root)
}

// A long list of short items (the games of a bundle) is shown in columns by the reader.
const markCompactLists = (root: Element) => {
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    const items = [...list.children].filter(child => child.tagName === 'LI')
    if (
      items.length >= MIN_COMPACT_ITEMS &&
      items.every(item => normalized(item.textContent).length <= MAX_COMPACT_ITEM_LENGTH && !item.querySelector(BLOCKS))
    )
      list.setAttribute('data-compact', '')
  }
}

// Wrappers left with nothing in them once their content went.
const removeEmptyBlocks = (root: Element) => {
  for (const element of [...root.querySelectorAll(BLOCKS)].reverse()) {
    if (normalized(element.textContent) === '' && !element.querySelector(MEDIA)) element.remove()
  }
}

// Removes an element and everything after it, up to the root: the rest of the page is footer.
// A credit for the text itself, kept wherever it stands: "This article is republished from The Conversation under
// a Creative Commons license."
export const TEXT_CREDIT = /(?<!\p{L})(republished|republié|licen[cs]e|translated|traduit)(?!\p{L})/iu
const MAX_CREDIT_BLOCK_LENGTH = 300

const isTextCredit = (element: Element) => {
  const text = normalized(element.textContent)
  return text.length <= MAX_CREDIT_BLOCK_LENGTH && TEXT_CREDIT.test(text)
}

const removeFrom = (element: Element, root: Element) => {
  let current: Element | null = element

  while (current && current !== root) {
    for (let next = current.nextElementSibling; next;) {
      const following: Element | null = next.nextElementSibling
      if (!isTextCredit(next)) next.remove()
      next = following
    }
    const parent: Element | null = current.parentElement
    if (current === element) current.remove()
    current = parent
  }
}

// Lists of short links before the first line of text, past short labels ("Menu"): the site's breadcrumb or menu
// ("1. Recettes plaisir").
// A breadcrumb's last item is the page itself, often not a link and as long as its title (Gamekult). A lone short
// link in a paragraph of its own goes too: the article's section ("news").
const MAX_CURRENT_PAGE_LENGTH = 200

const removeLeadingNavigation = (root: Element) => {
  const isLink = (item: Element) => {
    const text = normalized(item.textContent)
    return text !== '' && text.length <= MAX_LABEL_LENGTH && linkTextRatio(item) >= 0.8
  }
  const isNavigation = (list: Element) => {
    const items = [...list.children]
    const last = items.at(-1)
    if (!last) return false
    if (items.every(isLink)) return true
    return (
      items.length >= 2 &&
      !isLink(last) &&
      normalized(last.textContent).length <= MAX_CURRENT_PAGE_LENGTH &&
      items.slice(0, -1).every(isLink)
    )
  }
  for (const element of [...root.querySelectorAll(`${TEXT_BLOCKS}, ul, ol`)]) {
    if (!element.isConnected || element.matches('li')) continue
    const text = normalized(element.textContent)
    if (element.matches('ul, ol')) {
      if (isNavigation(element)) withWrappers(element, root).remove()
      continue
    }
    if (element.matches('p') && text !== '' && text.length <= MAX_LABEL_LENGTH && linkTextRatio(element) === 1) {
      withWrappers(element, root).remove()
      continue
    }
    // The first line of text, longer than a label: what follows is the article.
    if (text.length > MAX_LABEL_LENGTH) return
  }
}

// The same picture shown again further down (a teaser of another article, a carousel's copies): one is enough.
const removeRepeatedImages = (root: Element) => {
  const seen = new Set<string>()
  for (const image of [...root.querySelectorAll('img')]) {
    const source = image.getAttribute('src') ?? ''
    if (source === '') continue
    if (!seen.has(source)) {
      seen.add(source)
      continue
    }
    // With the link, figure or wrapper around it, as long as it holds nothing else.
    let block = image
    while (
      block.parentElement &&
      block.parentElement !== root &&
      normalized(block.parentElement.textContent) === normalized(block.textContent) &&
      block.parentElement.querySelectorAll('img').length === 1
    )
      block = block.parentElement
    block.remove()
  }
}

// A table of contents: links to the page's own headings, which the reader shows anyway. Its title goes too,
// and a title left without its list ("Sommaire", when the list is drawn by a script).
const TOC_TITLE = /^(sommaire|table of contents|article contents|contents|dans cet article|in this article)\b/i
const MAX_TOC_TITLE_LENGTH = 60

const isTableOfContents = (list: Element) => {
  const targets = [...list.querySelectorAll('a')].map(link => link.getAttribute('href') ?? '')
  if (targets.length < 2 || linkTextRatio(list) < 0.8) return false
  // Every link points into one page: "#part-1", or the article's own address followed by "#part-1".
  const pages = new Set(targets.map(href => (/#./.test(href) ? href.slice(0, href.indexOf('#')) : null)))
  return !pages.has(null) && pages.size === 1
}

const removeTablesOfContents = (root: Element) => {
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    if (!list.isConnected || !isTableOfContents(list)) continue
    const title = list.previousElementSibling
    if (title && normalized(title.textContent).length <= MAX_TOC_TITLE_LENGTH && !title.querySelector('img, ul, ol')) {
      title.remove()
    }
    withWrappers(list, root).remove()
  }
  for (const title of [...root.querySelectorAll(TEXT_BLOCKS)]) {
    const text = normalized(title.textContent)
    if (title.isConnected && text.length <= MAX_TOC_TITLE_LENGTH && TOC_TITLE.test(text)) title.remove()
  }
}

// Tags, related links and linked teaser images at the end of the text: nothing left to read there.
const MIN_UNLINKED_TEXT = 300
const trimTrailingLinks = (container: Element) => {
  for (let last = container.lastElementChild; last; last = container.lastElementChild) {
    const text = normalized(last.textContent)
    const linkedImagesOnly = text === '' && last.querySelector('a img, a picture') !== null

    // A heading with nothing after it: its list of links went.
    const heading = /^H[1-6]$/.test(last.tagName) || last.getAttribute('role') === 'heading'
    // A wrapper holding text of its own beside its links (the whole text in one div, at times) is trimmed from the
    // inside; one holding little more than links goes whole, its heading with it.
    const wrapper =
      last.matches('div, section, article, main') &&
      last.querySelectorAll(TEXT_BLOCKS).length > 1 &&
      text.length * (1 - linkTextRatio(last)) > MIN_UNLINKED_TEXT
    if (
      (text !== '' && !wrapper && linkTextRatio(last) > 0.6) ||
      linkedImagesOnly ||
      heading ||
      last.tagName === 'HR'
    ) {
      last.remove()
      continue
    }

    if (text === '' || !last.querySelector(BLOCKS)) return

    trimTrailingLinks(last)

    // Nothing left in it but empty wrappers.
    if (normalized(last.textContent) === '' && !last.querySelector('img, picture, video, iframe')) {
      last.remove()
      continue
    }

    return
  }
}

// The page's own controls, never part of the text: forms (a newsletter sign-up), "Skip to main content" links,
// and "Follow" buttons, recognised by their icon's label.
const SKIP_LINK = /^(skip to|jump to|aller au|passer au|accéder au) (the )?(main )?(content|contenu|article)/i
const FOLLOW_BUTTON = /^(follow|suivre|s’abonner|s'abonner|subscribe)$/i

const removeSiteControls = (root: Element) => {
  for (const form of [...root.querySelectorAll('form')]) form.remove()
  for (const link of [...root.querySelectorAll('a[href*="#"]')]) {
    if (SKIP_LINK.test(normalized(link.textContent))) withWrappers(link, root).remove()
  }
  for (const icon of [...root.querySelectorAll('svg[aria-label]')]) {
    if (!icon.isConnected || !FOLLOW_BUTTON.test(icon.getAttribute('aria-label') ?? '')) continue
    const button = icon.closest('li, button, a, p, div')
    if (!button || button === root) continue
    withWrappers(button, root).remove()
  }
}

// Emphasis that covers a whole paragraph or list item says nothing (a synopsis all in italics, "Liste du casting :"
// in bold italics): the text stays, the emphasis goes. A list of one short emphasised item is a section label from
// the site's template ("ARTICLE ORIGINAL"): it goes.
const EMPHASIS = 'em, i, strong, b'
const MAX_LABEL_LENGTH = 40
const MIN_PROSE_WORDS = 8
const CODE_SIGNS = /[{};<>=$]|\(\)|=>|\b(function|const|let|var|import|return|def|class)\b/

const isFullyEmphasised = (block: Element) => {
  const text = normalized(block.textContent)
  return text !== '' && [...block.querySelectorAll(EMPHASIS)].some(mark => normalized(mark.textContent) === text)
}

const removeFullEmphasis = (root: Element) => {
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    const items = [...list.children]
    const [item] = items
    if (
      items.length === 1 &&
      item &&
      !item.querySelector('a') &&
      normalized(item.textContent).length <= MAX_LABEL_LENGTH &&
      isFullyEmphasised(item)
    ) {
      list.remove()
    }
  }
  for (const block of [...root.querySelectorAll('p, li')]) {
    if (!isFullyEmphasised(block) || block.closest('h1, h2, h3, h4, h5, h6')) continue
    for (const mark of [...block.querySelectorAll(EMPHASIS)]) mark.replaceWith(...mark.childNodes)
  }
  // The same for a whole paragraph set as code when it is prose (a prompt quoted on a blog): real code stays.
  for (const code of [...root.querySelectorAll('p > code, li > code')]) {
    const text = normalized(code.textContent)
    if (
      text === normalized(code.parentElement?.textContent) &&
      text.split(' ').length >= MIN_PROSE_WORDS &&
      !CODE_SIGNS.test(text)
    ) {
      code.replaceWith(...code.childNodes)
    }
  }
}

// "Dans le reste de la série…" and its list of links to other articles; what follows it, if short, is the site's
// footer ("contact the team", "a project supported by…").
const MIN_RELATED_ITEMS = 3
const MAX_FOOTER_AFTER_RELATED = 600
const MIN_RELATED_TITLE = 35

const removeRelatedLists = (root: Element) => {
  for (const heading of [...root.querySelectorAll('h2, h3, h4')]) {
    const list = heading.nextElementSibling
    if (!heading.isConnected || !list?.matches('ul, ol')) continue
    const items = [...list.children]
    if (items.length < MIN_RELATED_ITEMS || !items.every(item => linkTextRatio(item) >= 0.8)) continue
    // Article titles, not a list of shops or products the article is about.
    const average = items.reduce((total, item) => total + normalized(item.textContent).length, 0) / items.length
    if (average < MIN_RELATED_TITLE) continue

    // Everything after the list, up to the end of the article.
    let after = ''
    for (let current: Element | null = list; current && current !== root; current = current.parentElement) {
      for (let next = current.nextElementSibling; next; next = next.nextElementSibling)
        after += normalized(next.textContent)
    }
    const rule = heading.previousElementSibling?.matches('hr') ? heading.previousElementSibling : null
    if (after.length <= MAX_FOOTER_AFTER_RELATED) {
      removeFrom(rule ?? heading, root)
    } else {
      rule?.remove()
      list.remove()
      heading.remove()
    }
  }
}

// The reader's whole vocabulary: text blocks, lists, headings, links, quotes, pictures with their captions,
// inline emphasis, code and tables. Any other tag (div, span, section, font…) goes and its content stays; a
// wrapper holding only text becomes a paragraph. The groups and cards Hodi builds itself are kept as they are.
const KEPT_TAGS = new Set([
  'p',
  'ul',
  'ol',
  'li',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'blockquote',
  'figure',
  'figcaption',
  'img',
  'strong',
  'em',
  'br',
  'small',
  'sup',
  'sub',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption'
])
const RENAMED_TAGS: Record<string, string> = { b: 'strong', i: 'em', h1: 'h2' }
const DROPPED_TAGS = new Set([
  'hr',
  'source',
  'svg',
  'button',
  'input',
  'select',
  'textarea',
  'nav',
  'script',
  'style',
  'video',
  'audio',
  'iframe',
  'object',
  'embed'
])
const BLOCK_CHILDREN =
  'p, ul, ol, h2, h3, h4, h5, h6, blockquote, figure, table, pre, div, section, article, aside, header, footer, main'
// Places where a run of text is fine as it is, with no paragraph around it.
const INLINE_HOME = 'p, li, h2, h3, h4, h5, h6, td, th, caption, figcaption, a, strong, em, small, sup, sub, code, pre'

const isOwnBlock = (element: Element) =>
  element.matches('[data-gallery], [data-embed-author], [data-embed-date]') ||
  (element.tagName === 'SPAN' && element.closest('a[data-embed-card], [data-embed-author]') !== null)

const isInlineNode = (node: Element['childNodes'][number]) =>
  node.nodeType === 3 || (node.nodeType === 1 && !(node as unknown as Element).matches(BLOCK_CHILDREN))

// Runs of text and inline tags between blocks get a paragraph each, so no text floats between blocks.
const wrapInlineRuns = (container: Element) => {
  let run: Element['childNodes'][number][] = []
  const flush = (before: Element['childNodes'][number] | null) => {
    if (
      run.some(
        node =>
          normalized(node.textContent) !== '' || (node.nodeType === 1 && (node as unknown as Element).matches('img'))
      )
    ) {
      // Blank space around the run stays outside the paragraph.
      const isBlank = (node: Element['childNodes'][number]) =>
        node.nodeType === 3 && normalized(node.textContent) === ''
      while (run.length > 0 && isBlank(run[0] as Element['childNodes'][number])) run.shift()
      while (run.length > 0 && isBlank(run[run.length - 1] as Element['childNodes'][number])) run.pop()
      const paragraph = container.ownerDocument.createElement('p')
      container.insertBefore(paragraph, before)
      paragraph.append(...run)
    }
    run = []
  }
  for (const node of [...container.childNodes]) {
    if (isInlineNode(node)) run.push(node)
    else flush(node)
  }
  flush(null)
}

const simplifyTags = (root: Element) => {
  for (const element of [...root.querySelectorAll('*')].reverse()) {
    const tag = element.tagName.toLowerCase()
    if (KEPT_TAGS.has(tag) || isOwnBlock(element)) continue
    if (DROPPED_TAGS.has(tag)) {
      element.remove()
      continue
    }
    const renamed = RENAMED_TAGS[tag]
    const parent = element.parentElement
    if (
      renamed ||
      (!element.querySelector(BLOCK_CHILDREN) &&
        parent &&
        !parent.closest(INLINE_HOME) &&
        normalized(element.textContent) !== '' &&
        /^(div|section|article|aside|header|footer|main|center|details|summary|dl|dd|dt|address)$/.test(tag))
    ) {
      // A heading or emphasis under its standard name; a wrapper of text alone, a paragraph.
      const replacement = element.ownerDocument.createElement(renamed ?? 'p')
      replacement.append(...element.childNodes)
      element.replaceWith(replacement)
      continue
    }
    if (element.querySelector(BLOCK_CHILDREN) && !element.closest(INLINE_HOME)) wrapInlineRuns(element)
    element.replaceWith(...element.childNodes)
  }
  wrapInlineRuns(root)
}

export const cleanArticleHtml = (html: string) => {
  const { document } = parseHTML(`<!doctype html><html><body><div id="hodi-root">${html}</div></body></html>`)
  const root = document.getElementById('hodi-root') as Element

  for (const image of [...root.querySelectorAll('img')]) {
    if (/logo/i.test(`${image.getAttribute('src') ?? ''} ${image.getAttribute('alt') ?? ''}`)) image.remove()
  }
  removeSiteControls(root)
  removeTablesOfContents(root)

  for (const element of [...root.querySelectorAll(`${BLOCKS}, ${NOISE_CANDIDATES}`)]) {
    if (!element.isConnected) continue

    const text = normalized(element.textContent)

    if (text.length < 40 && FOOTER_HEADING.test(text)) {
      removeFrom(smallestEnclosingBlock(element, root), root)
      continue
    }

    if (text.length <= SMALL_BLOCK && NOISE_TEXT.test(text)) {
      smallestEnclosingBlock(element, root).remove()
      continue
    }

    if (text.length <= MAX_LOADING_LENGTH && LOADING_TEXT.test(text)) {
      withWrappers(element, root).remove()
      continue
    }

    if (!element.matches(BLOCKS)) continue

    if (element.matches(TEXT_BLOCKS) && PLACEHOLDER_TEXT.test(text)) {
      withWrappers(element, root).remove()
      continue
    }

    if (text.length <= MAX_READ_ALSO_LENGTH && READ_ALSO.test(text) && linkTextRatio(element) > 0.5) {
      withWrappers(element, root).remove()
      continue
    }

    // "À la une" and its list of links to other articles.
    if (text.length < 40 && LINK_LIST_HEADING.test(text) && !element.querySelector(BLOCKS)) {
      const next = element.nextElementSibling
      if (next && linkTextRatio(next) > 0.6) next.remove()

      const parent = element.parentElement
      if (parent && parent !== root && linkTextRatio(parent) > 0.6) parent.remove()
      else element.remove()
    }
  }

  removeBylines(root)
  removeLeadingNavigation(root)
  removeRepeatedImages(root)
  replaceFrames(root)
  removeEmptyImages(root)
  markEmbeds(root)
  removeEmptyEmbeds(root)
  tidyCaptions(root)
  flattenCaptions(root)
  removeFullEmphasis(root)
  removeRelatedLists(root)
  removeEmptyBlocks(root)
  removeTrailingRule(root)
  trimTrailingLinks(root)
  markCompactLists(root)
  groupPictures(root)
  simplifyTags(root)

  // A lead paragraph repeated as the first paragraph of the text: keep one, the longest.
  const blocks = [...root.querySelectorAll(TEXT_BLOCKS)].filter(block => !block.querySelector(TEXT_BLOCKS))
  const kept: { element: Element; text: string }[] = []

  for (const element of blocks) {
    const text = normalized(element.textContent)

    if (text.length < MIN_DUPLICATE_LENGTH) continue

    const earlier = kept.find(candidate => candidate.text.startsWith(text) || text.startsWith(candidate.text))

    if (!earlier) {
      kept.push({ element, text })
    } else if (text.length > earlier.text.length) {
      earlier.element.remove()
      Object.assign(earlier, { element, text })
    } else {
      element.remove()
    }
  }

  return root.innerHTML
}

// Below this, the page is most likely a paywall teaser, a video page or a cookie wall.
export const MIN_TEXT_LENGTH = 600

// Ad slots and promoted blocks, by their class or id: removed before Readability scores the page, so an ad
// between two parts of the text cannot split it.
const AD_TOKEN =
  /^(ads?|advert\w*|ad[-_]\w+|\w+[-_]ads?|adsbygoogle|sponsor\w*|outbrain\w*|taboola\w*|publicite|pub[-_]\w+|dfp\w*|teads\w*)$/i
const NOT_CONTENT = 'script, style, noscript, iframe, form, button, nav, svg, template, dialog'

const removeAds = (root: Element) => {
  for (const element of [...root.querySelectorAll('[class], [id]')]) {
    if (!element.isConnected || element.matches('html, body, article, main')) continue
    const tokens = `${element.getAttribute('class') ?? ''} ${element.getAttribute('id') ?? ''}`.split(/\s+/)
    if (!tokens.some(token => AD_TOKEN.test(token))) continue
    // A page wrapper that also carries an ad skin's class (VGC) holds the article: an ad holds no paragraphs.
    const paragraphs = [...element.querySelectorAll('p')].filter(p => normalized(p.textContent).length > 100)
    if (paragraphs.length < 3) element.remove()
  }
}

// A card that labels itself as an ad ("Sponsorisé", with a brand's offer): the label's card goes with it,
// as long as it holds none of the article's paragraphs.
const AD_LABEL = /^(sponsorisé|sponsored|publicité|advertisement|annonce|contenu sponsorisé|sponsored content)$/i
const MAX_AD_CARD_LENGTH = 500
const MAX_AD_PARAGRAPH_LENGTH = 150

const removeLabelledAds = (root: Element) => {
  for (const label of [...root.querySelectorAll('div, span, p, small, strong')]) {
    if (!label.isConnected || label.children.length > 0 || !AD_LABEL.test(normalized(label.textContent))) continue
    let card = label
    for (let parent = card.parentElement; parent; parent = parent.parentElement) {
      if (parent.matches('body, article, main') || parent.querySelector('h1')) break
      if (normalized(parent.textContent).length > MAX_AD_CARD_LENGTH) break
      if ([...parent.querySelectorAll('p')].some(p => normalized(p.textContent).length > MAX_AD_PARAGRAPH_LENGTH)) break
      card = parent
    }
    if (card !== label) card.remove()
  }
}

// Readability judges a block by its class and id: it drops "sidebar" blocks before scoring the page, and scores
// down "share" and "comment" ones. ActuGaming names its two-column layout "sidebar", text column included, and wraps
// the text in its share block: the article was lost, and a sponsored card or the related links came instead.
// The word on its own ("ag-sidebar"), not inside a longer name: the BBC's "ContainerWithSidebarWrapper" also holds
// its tag list, which Readability rightly leaves out.
const SIDEBAR = /(^|[\s_-])sidebar([\s_-]|$)/i
const MIN_REAL_PARAGRAPH = 300

const unmarkLayoutBlocks = (root: Element) => {
  // A "sidebar" holding the article's title (its h1) is the page's layout: it loses that word.
  const title = root.querySelector('h1')
  for (
    let element: Element | null = title?.parentElement ?? null;
    element && element !== root;
    element = element.parentElement
  ) {
    const tokens: string[] = (element.getAttribute('class') ?? '').split(/\s+/)
    if (tokens.some(token => SIDEBAR.test(token))) {
      element.setAttribute('class', tokens.filter(token => token !== '' && !SIDEBAR.test(token)).join(' '))
    }
    if (SIDEBAR.test(element.getAttribute('id') ?? '')) element.removeAttribute('id')
  }
  // A heading's id is an anchor made from its words ("h-comment-installer-le-mod"): Readability reads it as a
  // layout word and drops the heading.
  for (const heading of [...root.querySelectorAll('h2[id], h3[id], h4[id], h5[id], h6[id]')]) {
    heading.removeAttribute('id')
  }
  // A share block holding a real paragraph is taken away and its content left in its place, so the text also sits
  // next to its standfirst again (Readability adds a block's siblings, not its parent's).
  for (const element of [...root.querySelectorAll('[class*="share" i], [id*="share" i]')]) {
    if (!element.isConnected || element.matches('html, body, article, main')) continue
    if ([...element.querySelectorAll('p')].some(p => normalized(p.textContent).length >= MIN_REAL_PARAGRAPH)) {
      element.replaceWith(...element.childNodes)
    }
  }
}

// A live page whose posts are drawn by a script (France 24's live blogs) also sends them in the page, in a hidden
// copy: Readability skips hidden blocks, and only the page's header was left. The copy is shown again, only inside a
// block that says it is a live blog, so that a hidden article (a paywall's) stays hidden.
const LIVE_BLOG = '[data-liveblog], [class*="liveblog" i], [class*="live-blog" i]'

const showLiveBlogPosts = (root: Element) => {
  for (const live of [...root.querySelectorAll(LIVE_BLOG)]) {
    for (const hidden of [...live.querySelectorAll('[style*="display" i]')]) {
      if (/display\s*:\s*none/i.test(hidden.getAttribute('style') ?? '') && hidden.querySelector('p')) {
        hidden.removeAttribute('style')
      }
    }
  }
}

// Some sites (Ars Technica, the BBC) cut the text into several blocks of the same kind, with ads or
// pictures between them; Readability keeps the block it scored best and loses the rest. The other blocks
// shaped like the one the text starts in are added back, in page order.
const MIN_PART_LENGTH = 150

const signatureOf = (element: Element) =>
  [element.tagName, element.getAttribute('class') ?? '', element.getAttribute('data-component') ?? ''].join('|')

const recoverSplitText = (page: Element, extracted: string) => {
  const { document } = parseHTML(`<!doctype html><html><body>${extracted}</body></html>`)
  const paragraphs = [...document.body.querySelectorAll('p')].map(p => normalized(p.textContent)).filter(Boolean)
  const first = paragraphs[0]
  if (!first) return extracted
  const start = [...page.querySelectorAll('p')].find(p => normalized(p.textContent) === first)
  let block = start?.parentElement ?? null
  while (block && !block.getAttribute('class') && !block.getAttribute('data-component')) block = block.parentElement
  if (!block || block.matches('body, html, article, main')) return extracted
  const signature = signatureOf(block)
  const known = new Set(paragraphs)
  const parts = [...page.querySelectorAll(block.tagName)].filter(
    candidate =>
      signatureOf(candidate) === signature &&
      !candidate.contains(block) &&
      !block.contains(candidate) &&
      normalized(candidate.textContent).length >= MIN_PART_LENGTH
  )
  // Blocks after the article's title (its h1), or after the first block when the page has none: what comes
  // before is the site's header. Page order is read from the element list (linkedom's compareDocumentPosition
  // is not reliable).
  const order = [...page.querySelectorAll('*')]
  const title = page.querySelector('h1')
  const from = title ? order.indexOf(title) : order.indexOf(block)
  const after = parts.filter(candidate => order.indexOf(candidate) > from)
  const added = after.filter(candidate =>
    [...candidate.querySelectorAll('p')].some(p => !known.has(normalized(p.textContent)) && normalized(p.textContent))
  )
  if (added.length === 0) return extracted
  for (const part of added) for (const junk of [...part.querySelectorAll(NOT_CONTENT)]) junk.remove()
  const position = order.indexOf(block)
  const html = (list: Element[]) => list.map(part => part.innerHTML).join('')
  return `${html(added.filter(part => order.indexOf(part) < position))}${extracted}${html(
    added.filter(part => order.indexOf(part) > position)
  )}`
}

// Reader-mode extraction. The HTML is sanitized again in the browser before display.
export const extractArticle = (html: string, url: string): ExtractedArticle | null => {
  const withBase = html.replace(/<head(\s[^>]*)?>/i, match => `${match}<base href="${url.replace(/"/g, '%22')}">`)
  const { document } = parseHTML(withBase)
  const image = shareImage(document, url)
  showLazyImages(document)
  removeAds(document.body as unknown as Element)
  removeLabelledAds(document.body as unknown as Element)
  unmarkLayoutBlocks(document.body as unknown as Element)
  showLiveBlogPosts(document.body as unknown as Element)
  // Readability changes the page it reads: a copy is kept to find the text's other blocks.
  const page = parseHTML(document.toString()).document.body as unknown as Element
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], {
    charThreshold: 300
  }).parse()

  if (!article?.content || (article.length ?? 0) < MIN_TEXT_LENGTH) {
    return null
  }

  // Counted again once cleaned: a video page's captions, credits and consent notice can pass the first count
  // and leave only a few lines (France 24).
  const contentHtml = cleanArticleHtml(recoverSplitText(page, article.content))
  const textLength = normalized(
    parseHTML(`<!doctype html><html><body>${contentHtml}</body></html>`).document.body.textContent
  ).length
  if (textLength < MIN_TEXT_LENGTH) return null

  return {
    title: article.title ?? null,
    byline: article.byline ?? null,
    contentHtml,
    textLength,
    image
  }
}

// Article HTML carried by a feed (content:encoded), run through the same extraction.
export const extractFeedContent = (contentHtml: string, url: string) =>
  extractArticle(`<html><head></head><body><article>${contentHtml}</article></body></html>`, url)

// About 230 words a minute, some 1,380 characters: shown on the article's card.
export const CHARACTERS_PER_MINUTE = 1380
export const readingMinutes = (article: ExtractedArticle) =>
  Math.max(1, Math.round(article.textLength / CHARACTERS_PER_MINUTE))

const MAX_AUTHOR_LENGTH = 80

// The byline as a name for the card: "Par Marie Dupont" gives "Marie Dupont"; a long byline is page text, not a name.
export const articleAuthor = (article: ExtractedArticle) => {
  const author = (article.byline ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(par|by)\s+/i, '')
  return author.length > 0 && author.length <= MAX_AUTHOR_LENGTH ? author : null
}
