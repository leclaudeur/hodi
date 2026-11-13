import { useEffect, useState } from 'react'
import {
  type YouthCatalogueTopic,
  type YouthLimits,
  type YouthTopic,
  type YouthWeek,
  getYouthRules,
  getYouthSources,
  getYouthTopics,
  getYouthWeek
} from '../../../../api.ts'

export type Opened = 'edit' | 'sources' | 'topics' | 'daily' | 'window' | 'quiet' | 'explain' | 'week'

export interface Loaded {
  limits: YouthLimits
  sources: YouthCatalogueTopic[]
  topics: YouthTopic[]
  week: YouthWeek
}

// A young profile's rules, sources, themes and week, once it is known to be a young one.
export const useYoungLoad = (id: number, young: boolean | undefined) => {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!young) return
    let cancelled = false
    Promise.all([getYouthRules(id), getYouthSources(id), getYouthTopics(id), getYouthWeek(id)])
      .then(([limits, sources, topics, week]) => {
        if (!cancelled) setLoaded({ limits, sources, topics, week })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, young])
  return { loaded, setLoaded, failed }
}
