import { Fragment, type ReactNode } from 'react'

const MARK = /<(b|i)>(.*?)<\/\1>/g

// A translated text that already went through t(), with its <b> (a name, an e-mail) and its <i> (a screen's name), as
// page and dialog intros receive it. Any other text, or a node, is left as it is.
export const rich = (text: ReactNode): ReactNode => {
  if (typeof text !== 'string' || !text.includes('<')) return text
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(MARK)) {
    parts.push(text.slice(last, match.index))
    const Tag = match[1] === 'b' ? 'strong' : 'em'
    parts.push(<Tag key={match.index}>{match[2]}</Tag>)
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return <Fragment>{parts}</Fragment>
}
