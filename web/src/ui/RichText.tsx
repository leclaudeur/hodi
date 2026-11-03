import type { ParseKeys } from 'i18next'
import { Trans } from 'react-i18next'

interface RichTextProps {
  i18nKey: ParseKeys
  values?: Record<string, string | number>
}

// A locale text with its <b> and <i>: what matters in a sentence read once, before a click that can't be undone.
const RichText = ({ i18nKey, values }: RichTextProps) => (
  // The key is checked above: Trans's own typing of it, crossed with its other props, is too large for TypeScript.
  <Trans i18nKey={i18nKey as never} values={values} components={{ b: <strong />, i: <em /> }} />
)

export default RichText
