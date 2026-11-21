// The theme a source's card shows and how many more it has: the one browsed or filtered on, if it has it, else its
// first.
export const cardTopicOf = <T extends { id: string }>(topics: T[], preferred: readonly string[]) => {
  const topic = topics.find(candidate => preferred.includes(candidate.id)) ?? topics[0] ?? null
  return { topic, moreTopics: Math.max(0, topics.length - 1) }
}
