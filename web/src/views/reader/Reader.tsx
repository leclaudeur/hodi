import { useRef } from 'react'
import { useSpeech } from '../../lib/speech.ts'
import { nextArticle } from '../../lib/reading-list.ts'
import { relatedOf, topicOfArticle } from '../../lib/related.ts'
import NotFound from '../NotFound.tsx'
import { DesktopReader, ListenButton, PhoneReader, ReaderShell } from './ReaderFrames.tsx'
import { type Layout, ReaderFailed, ReaderSkeleton } from './ReaderParts.tsx'
import { LinkBody, ReadableBody, ReaderHeader } from './ReaderView.tsx'
import { useArticle, useArticleText, useTitleScrolled } from './use-article.ts'

interface ReaderProps {
  articleId: string
  layout: Layout
  // A tablet held across shows the desktop reader in place of the list: with a visible back button.
  withBack?: boolean
  onBack: () => void
  onUnauthorized: () => void
}

// The article, read in Hodi: in the panel beside the list on a computer, full screen on a phone.
// Rendered with key={articleId}: each article starts from its own state.
// The article, read in Hodi: in the panel beside the list on a computer, full screen on a phone.
// Rendered with key={articleId}: each article starts from its own state.
const Reader = ({ articleId, layout, withBack = false, onBack, onUnauthorized }: ReaderProps) => {
  const { result, error, retry, contentHtml, readingMinutes, exactMinutes } = useArticle(articleId, onUnauthorized)
  const content = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const shown = result?.status === 'ok' ? result.item : null
  const speech = useSpeech(content, shown?.lang ?? 'fr')

  useArticleText(content, shown, { contentHtml, readingMinutes, exactMinutes })
  const scrolled = useTitleScrolled(title, result !== null && result.status !== 'not_found', layout)

  const shell = { layout, withBack, onBack }
  if (result?.status === 'not_found')
    return (
      <ReaderShell {...shell}>
        <NotFound />
      </ReaderShell>
    )
  if (error)
    return (
      <ReaderShell {...shell}>
        <ReaderFailed onRetry={retry} />
      </ReaderShell>
    )
  if (!result)
    return (
      <ReaderShell {...shell} busy>
        <ReaderSkeleton layout={layout} />
      </ReaderShell>
    )

  const { item } = result
  const readable = result.status === 'ok'
  const canSummarize = readable && result.canSummarize === true
  const isPhone = layout === 'phone'
  // Touch sizes on a tablet, as everywhere a finger is expected.
  const barSize = withBack ? 44 : 34
  const after = { related: relatedOf(item.id), next: nextArticle(item.id), layout }
  const frame = {
    item,
    readable,
    canSummarize,
    bookmarkItem: { ...item, access: readable ? 'reader' : 'link', readingMinutes } as const,
    contentRef: content,
    header: (
      <ReaderHeader
        item={item}
        topic={topicOfArticle(item.id)}
        readable={readable}
        isPhone={isPhone}
        byline={readable ? result.article.byline : null}
        readingMinutes={readingMinutes}
        titleRef={title}
      />
    ),
    body: readable ? (
      <ReadableBody
        item={item}
        canSummarize={canSummarize}
        contentRef={content}
        contentHtml={contentHtml}
        onUnauthorized={onUnauthorized}
        {...after}
      />
    ) : (
      <LinkBody item={item} onRetry={result.status === 'failed' ? retry : null} {...after} />
    ),
    listen: readable && speech.supported && (
      <ListenButton
        state={speech.state}
        isPhone={isPhone}
        size={isPhone ? 44 : barSize}
        onToggle={() => speech.toggle()}
      />
    ),
    speechState: speech.state,
    onToggleSpeech: () => speech.toggle(),
    onStopSpeech: speech.stop,
    onBack
  }
  if (isPhone) return <PhoneReader {...frame} />
  return <DesktopReader {...frame} withBack={withBack} scrolled={scrolled} barSize={barSize} />
}

export default Reader
