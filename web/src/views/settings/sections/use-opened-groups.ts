import { useState } from 'react'
import { useTourStep } from '../../../lib/tour.ts'
import type { GroupId, SourceGroup } from './sources-model.ts'

// The first group open as the page opens, the others closed: their titles and counts are the page's summary, and
// a long group scrolls inside its card. During the tour, the sites stay open.
export const useOpenedGroups = () => {
  const touring = useTourStep() !== null
  const [opened, setOpened] = useState<GroupId[]>(touring ? ['mine'] : [])
  // The sources shown or hidden since the page or an accordion opened, with their state before: they keep their
  // place until then, so a card does not jump away from the toggle just used.
  const [held, setHeld] = useState<Record<string, boolean>>({})
  const toggle = (id: GroupId) => {
    if (!opened.includes(id)) setHeld({})
    // One group open at a time, as every accordion: the list stays short and the add button under it near.
    setOpened(ids => (ids.includes(id) ? ids.filter(other => other !== id) : [id]))
  }
  return { touring, opened, setOpened, held, setHeld, toggle }
}

interface OpeningInput {
  touring: boolean
  loaded: boolean
  requestsFirst: boolean
  groups: SourceGroup[]
  query: string
  opened: GroupId[]
  setOpened: (update: GroupId[] | ((ids: GroupId[]) => GroupId[])) => void
}

// Once the sources are in, the first group shown opens: a teen's requests when it has some, else its first
// non-empty group. A new filter or search opens every group once; each can be closed after. Back to everything,
// the groups open before come back.
export const useGroupOpening = ({ touring, loaded, requestsFirst, groups, query, opened, setOpened }: OpeningInput) => {
  const [firstOpened, setFirstOpened] = useState(touring)
  if (!firstOpened && loaded) {
    setFirstOpened(true)
    const first = requestsFirst ? 'requests' : groups.find(group => group.sources.length > 0)?.id
    if (first) setOpened(ids => (ids.includes(first) ? ids : [...ids, first]))
  }
  const [openedFor, setOpenedFor] = useState({ query, before: opened })
  if (openedFor.query !== query) {
    setOpenedFor({ query, before: openedFor.query ? openedFor.before : opened })
    setOpened(query ? ['mine', 'channels', 'household', 'base'] : openedFor.before)
  }
}
