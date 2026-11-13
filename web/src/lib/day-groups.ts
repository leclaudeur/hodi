// Entries already sorted newest first, cut into one group per day. dayOf gives an entry's day (YYYY-MM-DD), itemOf
// the article shown for it.
export const groupByDay = <Entry, Item>(
  entries: Entry[],
  dayOf: (entry: Entry) => string,
  itemOf: (entry: Entry) => Item
): { day: string; items: Item[] }[] => {
  const groups: { day: string; items: Item[] }[] = []
  for (const entry of entries) {
    const day = dayOf(entry)
    const group = groups.at(-1)
    if (group?.day === day) group.items.push(itemOf(entry))
    else groups.push({ day, items: [itemOf(entry)] })
  }
  return groups
}
