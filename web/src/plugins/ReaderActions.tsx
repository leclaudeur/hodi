import { type ComponentType, useMemo } from 'react'
import PluginSlot from './PluginSlot.tsx'
import { type ReaderArticle, usePlugins } from './registry.ts'

interface ActionProps {
  id: string
  action: ComponentType<{ article: ReaderArticle }>
  article: ReaderArticle
}

// One plugin's action. The slot's component stays the same while the article does, so what the plugin keeps (an
// open dialog, a sent report) is not lost when the reader draws again.
const Action = ({ id, action: Draw, article }: ActionProps) => {
  const slot = useMemo(() => () => <Draw article={article} />, [Draw, article])
  return <PluginSlot id={id} component={slot} />
}

// What active plugins add at the end of an article, beside "Lire l'original". A plugin that fails draws nothing here.
const ReaderActions = ({ id, title, url, sourceId, sourceName }: ReaderArticle) => {
  const { plugins, web } = usePlugins()
  // The same object while the article stays, so each slot keeps its component.
  const article = useMemo(() => ({ id, title, url, sourceId, sourceName }), [id, title, url, sourceId, sourceName])
  return plugins
    .filter(plugin => plugin.enabled && !plugin.error)
    .map(plugin => {
      const action = web.get(plugin.id)?.readerAction
      return action ? (
        <Action key={`${plugin.id}:${article.id}`} id={plugin.id} action={action} article={article} />
      ) : null
    })
}

export default ReaderActions
