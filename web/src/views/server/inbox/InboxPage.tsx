import { inboxItemOf } from '../../../lib/server-inbox.ts'
import InboxItemPage from './InboxItemPage.tsx'
import { useInbox } from './use-inbox.ts'

// The item the address opens; on a computer with none chosen, the first of the list, as Comptes.
const InboxPage = ({ item, layout }: { item?: string; layout: 'desktop' | 'phone' }) => {
  const { items, reviews } = useInbox()
  if (!items) return null
  const shown = item ? inboxItemOf(items, item) : (items[0] ?? null)
  return <InboxItemPage key={shown?.id ?? 'none'} item={shown} reviews={reviews} layout={layout} />
}

export default InboxPage
