// Site furniture Readability keeps around the text (RTL info): bylines with "add us to
// your Google favorites" and the author's photo, link lists such as "À la une", logos.
export const NOISE_TEXT =
  /ajoutez-nous à vos favoris google|^par .{0,80}publié le \d{1,2} \S+ (\d{4} )?à \d{1,2}h\d{2}/i
export const LINK_LIST_HEADING =
  /^(à|a) la une|^([àa] )?lire aussi|^sur le même sujet|^dans l'actualité|^nos autres (guides|articles|dossiers)|^([àa] )?voir aussi|^pour aller plus loin|^related( articles| stories)?$|^more from|^sur le même thème|^vous aimerez aussi|^d['’]autres actualités|^les plus lus|^most (read|popular)$|^articles connexes|^related content/i
// "À lire aussi : <link>", in a paragraph or a quote of its own, in the middle of the text. Some sites drop the
// accent: "A lire aussi" (Vogue, Futura).
export const READ_ALSO =
  /^(([àa] )?lire aussi|([àa] )?voir aussi|à découvrir|sur le même sujet|read (more|also)|see also|related)\s*:?/i
export const MAX_READ_ALSO_LENGTH = 300
// Everything from this heading on is the site's footer: sponsored links, more articles, tags.
export const FOOTER_HEADING =
  /^contenus? sponsorisés?|^contenus? partenaires?|^sponsorisé\s*:?$|^commentaires?$|^comments?$|^mots-clés( associés)?$|^tags?\s*:?$|^sources?\s*:?$|^à propos de l['’]auteur$|^about the author$|^(ses|ces) derniers articles$|^du même auteur$|^(more|latest) (stories |articles )?(from|by) (this|the) author$|^who['’]s behind this story\??$|^topics$|^ça vous a intéressé|^(les? |la )?(jeux?|sociétés?|articles?|tests?) en rapport$|^vidéo du moment$/i
// What a site shows in place of an embed (a tweet, a video) until its cookies are accepted, and its
// prompts to install it or read it elsewhere: nothing of the article.
export const PLACEHOLDER_TEXT = new RegExp(
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
export const LOADING_TEXT = /^(chargement|loading)( d(u|e la|e l.|es))?\s*[\p{L}' ]{0,30}?\s*(…|\.{3})?$/iu
export const MAX_LOADING_LENGTH = 50
// Below this, an image is an icon or a logo: a network's, an app's, a sharing button's.
export const MAX_ICON_SIZE = 100
// After the last rule of the page, less than this is footer: share buttons, a newsletter prompt.
export const MAX_TRAILING_TEXT = 250
// A list of short items, as the games of a bundle: shown in columns.
export const MIN_COMPACT_ITEMS = 8
export const MAX_COMPACT_ITEM_LENGTH = 50
// A caption that is only a credit: "©Gameblog", "Crédit : AFP".
export const CREDIT_ONLY = /^(©|\(c\)|crédits?\s*:|credits?\s*:|source\s*:|photo\s*:)/i
export const MAX_CREDIT_LENGTH = 80
// Bylines are often spans and links, not blocks: they are looked for too.
export const NOISE_CANDIDATES = 'span, a, em, time, small'
export const SMALL_BLOCK = 300
export const BLOCKS = 'p, div, section, aside, header, footer, figure, ul, ol, li, h1, h2, h3, h4, h5, h6, blockquote'
export const TEXT_BLOCKS = 'p, h2, h3, h4, h5, h6, blockquote, li'
export const MIN_DUPLICATE_LENGTH = 60
// Furniture any site can leave around the text, in French or English; the reader shows the source,
// the author and the date already.
// A byline on its own: "par Louis Vandendriessche", "By Jane Doe".
export const BYLINE_ONLY = /^(par|by)\s+\S.{0,60}$/i
// "Publié le 25 octobre à 09h06", "Publié le 25/10/2026 - 16:49 UTC+1" (Euronews),
// "Published Oct 25, 2026, 5:26 AM EDT", "Updated: October 25, 2026".
export const DATE_LINE = new RegExp(
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
export const ACCOUNT_PROMPT =
  /^(sign in|log in|sign up|subscribe|create (a|an|your) .{0,20}account|se connecter|connectez-vous|s'abonner|abonnez-vous|inscrivez-vous|créer un compte)\b/i
export const MAX_PROMPT_LENGTH = 80
export const LIVE_STATUS = /^(en cours|en direct|direct|live|terminé|ended|direct terminé|live ended)$/i
// An ad slot's label and a share button's, left as text: "Publicité, votre contenu continue ci-dessous", "Partager".
export const SLOT_LABEL =
  /^(publicité|espace publicitaire|advertisement|annonce)(\s*[,:–-].{0,40})?$|^(partager|partagez|share)( (cet|l['’])article| this( article)?)?$/i
// An author's bio: "Lucas Kloberdanz-Dyck is a writer for Collider…", "Marie Dupont est journaliste…".
export const AUTHOR_BIO =
  /^(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,3})\s+(?:is|est)\s+(?:a|an|the|un|une|le|la|l’|l')?\s*[^.]{0,60}?(?:writer|editor|journalist|reporter|contributor|critic|correspondent|journaliste|rédact|correspondant|critique|chroniqu|pigiste)/u
// The same bio when the name is in the block before it: "is a senior reporter covering technology…".
export const AUTHOR_BIO_TAIL =
  /^(is|est)\s+(a|an|the|un|une|le|la|l’|l')?\s*[^.]{0,60}?(writer|editor|journalist|reporter|contributor|critic|correspondent|journaliste|rédact|correspondant|critique|chroniqu|pigiste)/u
export const MAX_NAME_LENGTH = 40
export const MAX_BIO_LENGTH = 700
// Author photos: their alt is the author's name, or their path says what they are.
export const AUTHOR_IMAGE = /\/(auteurs?|authors?|avatars?|profiles?)\//i
export const AUTHOR_PAGE = /\/(auteurs?|authors?|journalistes?|redacteurs?)\//i
