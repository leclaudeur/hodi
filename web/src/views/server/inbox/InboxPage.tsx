import { firstOpen, inboxItemOf } from '../../../lib/server-inbox.ts'
import InboxItemPage from './InboxItemPage.tsx'
import { useInbox } from './use-inbox.ts'

// The item the address opens; on a computer with none chosen, the first source still to judge.
const InboxPage = ({ item, layout }: { item?: string; layout: 'desktop' | 'phone' }) => {
  const { items, reviews, reports } = useInbox()
  if (!items) return null
  const shown = item ? inboxItemOf(items, item) : firstOpen(items)
  return <InboxItemPage key={shown?.id ?? 'none'} item={shown} reviews={reviews} reports={reports} layout={layout} />
}

export default InboxPage
