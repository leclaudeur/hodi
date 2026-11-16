// Every e-mail Hodi sends, its own and its plugins', built from a few blocks into one dark template, with a plain-text
// version beside it for the mail apps that show no HTML. Hodi decides the layout and the space between blocks, so
// every e-mail looks the same and no plugin can put HTML of its own in one.

export type MailBlock =
  | { kind: 'text'; text: string }
  // A short line under the block before it: « Valable 30 minutes » under a code.
  | { kind: 'caption'; text: string }
  | { kind: 'action'; label: string; url: string }
  | { kind: 'code'; code: string }
  | { kind: 'rows'; title?: string; rows: MailRow[] }
  // The last words, under a line: « Si tu n'as rien demandé, ignore cet e-mail ».
  | { kind: 'note'; text: string }

export interface MailRow {
  label: string
  value: string
  change?: { text: string; good: boolean }
}

export interface MailContent {
  // The small line above the title: what the e-mail is about.
  eyebrow?: string
  title: string
  blocks: MailBlock[]
}

export interface MailFrame {
  // « Le bouton ne marche pas ? Copie ce lien : », in the recipient's language.
  linkFallback: string
  // Who sent it, under the card: « Envoyé par Hodi ».
  sentBy: string
  // Hodi's address (Serveur › E-mail), where the logo is; null without one.
  logo: string | null
  // The address under the card: the public site (Serveur › Général), else Hodi's; null without either.
  address: string | null
}

// The only markup a text keeps: <i>…</i>, for a name the interface quotes, in italics rather than between quotes.
const ITALIC = /<i>(.*?)<\/i>/g

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A text's HTML: escaped, its <i> kept, its line breaks kept.
const richText = (text: string) =>
  text
    .split(ITALIC)
    .map((piece, index) => (index % 2 === 1 ? `<i>${escape(piece)}</i>` : escape(piece)))
    .join('')
    .replace(/\n/g, '<br>')

const plainText = (text: string) => text.replace(ITALIC, '$1')

// E-mail safe: tables and inline styles, the system's fonts, a PNG logo with its alt text, no SVG and no web font
// (caniemail.com). Rounded corners are a bonus: Outlook on Windows shows squares, and nothing else changes.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "Menlo,Consolas,'Courier New',monospace"
const C = {
  bg: '#0f0f10',
  card: '#131314',
  line: '#2e2e31',
  strong: '#3a3a3e',
  divider: '#262628',
  box: '#1b1b1d',
  text: '#f2f2f3',
  text2: '#a1a1a6',
  text3: '#8a8a90',
  foot: '#6c6c72',
  rust: '#c8693a',
  good: '#6fcf8e',
  bad: '#e88a7a'
}

const space = (height: number) =>
  `<tr><td height="${height}" style="height:${height}px;font-size:0;line-height:0">&nbsp;</td></tr>`
const row = (html: string) => `<tr><td style="padding:0">${html}</td></tr>`
const paragraph = (html: string, size: number, line: number, color: string, font = FONT) =>
  `<p style="margin:0;font-family:${font};font-size:${size}px;line-height:${line}px;color:${color}">${html}</p>`

const actionHtml = (label: string, url: string, frame: MailFrame) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${C.text}" style="border-radius:999px;background:${C.text}">` +
  `<a href="${escape(url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${C.bg};text-decoration:none">${escape(label)}&nbsp;&rarr;</a>` +
  `</td></tr></table>` +
  `<p style="margin:16px 0 0;font-family:${MONO};font-size:12px;line-height:18px;color:${C.text3};word-break:break-all">${escape(frame.linkFallback)}<br><span style="color:${C.text2}">${escape(url)}</span></p>`

const codeHtml = (code: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${C.box}" style="padding:14px 22px;border:1px solid ${C.strong};border-radius:12px;background:${C.box};font-family:${MONO};font-size:26px;line-height:32px;letter-spacing:4px;color:${C.text}">${escape(code)}</td></tr></table>`

const rowsHtml = (title: string | undefined, rows: MailRow[]) => {
  const heading = title
    ? `<p style="margin:0 0 8px;font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:${C.text3}">${escape(title)}</p>`
    : ''
  const cells = rows
    .map(({ label, value, change }, index) => {
      const top = index ? `border-top:1px solid ${C.divider};` : ''
      const delta = change
        ? `&nbsp;&nbsp;<span style="font-family:${MONO};font-size:12px;color:${change.good ? C.good : C.bad}">${escape(change.text)}</span>`
        : ''
      return (
        `<tr><td style="${top}padding:12px 16px;font-family:${FONT};font-size:14px;line-height:20px;color:${C.text2}">${escape(label)}</td>` +
        `<td align="right" style="${top}padding:12px 16px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${C.text};white-space:nowrap">${escape(value)}${delta}</td></tr>`
      )
    })
    .join('')
  return `${heading}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid ${C.line};border-radius:12px;border-collapse:separate">${cells}</table>`
}

const blockHtml = (block: MailBlock, frame: MailFrame) => {
  switch (block.kind) {
    case 'text':
      return paragraph(richText(block.text), 15, 24, C.text2)
    case 'caption':
    case 'note':
      return paragraph(richText(block.text), 13, 20, C.text3)
    case 'action':
      return actionHtml(block.label, block.url, frame)
    case 'code':
      return codeHtml(block.code)
    case 'rows':
      return rowsHtml(block.title, block.rows)
  }
}

// The one scale: 12 between a block and its caption, 16 between two texts, 24 around a block (a button, a code, a
// table), and 32 above the note's line, 24 under it.
const spaceBefore = (block: MailBlock, before: MailBlock) => {
  if (block.kind === 'note')
    return `${space(32)}<tr><td height="1" bgcolor="${C.divider}" style="height:1px;font-size:0;line-height:0;background:${C.divider}">&nbsp;</td></tr>${space(24)}`
  if (block.kind === 'caption') return space(12)
  return space(block.kind === 'text' && before.kind === 'text' ? 16 : 24)
}

const bodyHtml = (blocks: MailBlock[], frame: MailFrame) =>
  blocks
    .map((block, index) => (index ? spaceBefore(block, blocks[index - 1]!) : '') + row(blockHtml(block, frame)))
    .join('')

const logoHtml = (address: string | null) =>
  address
    ? `<img src="${escape(address)}/mail-logo.png" width="78" height="35" alt="Hodi" style="display:block;border:0;width:78px;height:35px;color:${C.text};font:bold 24px ${FONT}">`
    : `<span style="font-family:${FONT};font-size:24px;line-height:35px;font-weight:700;color:${C.text}">Hodi<span style="color:${C.rust}">.</span></span>`

export const mailHtml = (content: MailContent, frame: MailFrame, language: string) => {
  const eyebrow = content.eyebrow
    ? row(paragraph(escape(content.eyebrow), 11, 16, C.text3, `${MONO};letter-spacing:1px;text-transform:uppercase`)) +
      space(8)
    : ''
  const title = row(
    `<h1 style="margin:0;font-family:${FONT};font-size:26px;line-height:32px;font-weight:700;color:${C.text}">${escape(content.title)}<span style="color:${C.rust}">.</span></h1>`
  )
  // Under the card, on one line: who sent it on the left, the site on the right, written without its https://.
  const cell = `font-family:${MONO};font-size:11px;line-height:18px;color:${C.foot}`
  const site = frame.address
    ? `<td align="right" style="${cell};text-align:right"><a href="${escape(frame.address)}" style="color:${C.foot};text-decoration:none">${escape(frame.address.replace(/^https?:\/\//, ''))}</a></td>`
    : ''
  const foot = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="${cell}">${escape(frame.sentBy)}</td>${site}</tr></table>`
  return (
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
    `<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escape(content.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.bg}" bgcolor="${C.bg}">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}"><tr><td align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">` +
    `<tr><td style="padding:0 4px">${logoHtml(frame.logo)}</td></tr>${space(24)}` +
    `<tr><td bgcolor="${C.card}" style="padding:32px 28px;border:1px solid ${C.line};border-radius:16px;background:${C.card}">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${eyebrow}${title}${space(16)}${bodyHtml(content.blocks, frame)}</table>` +
    `</td></tr>${space(24)}` +
    `<tr><td style="padding:0 4px">${foot}</td></tr>` +
    `</table></td></tr></table></body></html>`
  )
}

// French puts a space before a colon.
const colonIn = (language: string) => (language === 'fr' ? ' : ' : ': ')

const blockText = (block: MailBlock, colon: string) => {
  switch (block.kind) {
    case 'text':
    case 'caption':
      return plainText(block.text)
    case 'note':
      return plainText(block.text)
    case 'action':
      return `${block.label}${colon.trimEnd()}\n${block.url}`
    case 'code':
      return block.code
    case 'rows':
      return [
        ...(block.title ? [block.title.toUpperCase()] : []),
        ...block.rows.map(({ label, value, change }) => `${label}${colon}${value}${change ? ` (${change.text})` : ''}`)
      ].join('\n')
  }
}

// The same e-mail in plain text: what a mail app without HTML shows, and what spam filters like to find.
export const mailText = (content: MailContent, frame: MailFrame, language: string) =>
  [
    content.title,
    ...content.blocks.map(block => blockText(block, colonIn(language))),
    `-- \n${[frame.sentBy, frame.address].filter(Boolean).join('\n')}`
  ].join('\n\n')

export const renderMail = (content: MailContent, frame: MailFrame, language: string) => ({
  html: mailHtml(content, frame, language),
  text: mailText(content, frame, language)
})
