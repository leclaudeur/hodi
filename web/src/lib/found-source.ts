import type { FoundSource } from '../api.ts'
import { t } from './i18n.ts'

// What happens to the source's articles, in a line.
export const readingLine = (source: FoundSource) => {
  if (source.origin === 'youtube') return t('addSource.videos')
  if (source.reader) return t('addSource.readable', { count: source.readable.ok, tried: source.readable.tried })
  return t('addSource.notReadable')
}
