import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type SourceStatus, TOPICS_CHANGED, UnauthorizedError, getSources, removeSource } from '../../../api.ts'
import { askToConfirm, ownProof } from '../../../lib/confirm.ts'
import { setMySources } from '../../../lib/preferences.ts'
import { showSaved } from '../../../lib/toast.ts'
import RichText from '../../../ui/RichText.tsx'
import type { AddSourceRequest } from './AddSourceDialog.tsx'

interface SourceActionsInput {
  replace: (sources: SourceStatus[]) => void
  adding: AddSourceRequest | null
  setAdding: (request: AddSourceRequest | null) => void
  onUnauthorized: () => void
}

// Removing a source, hiding the little-read ones and taking in a new one, each reloading the list after.
export const useSourceActions = ({ replace, adding, setAdding, onUnauthorized }: SourceActionsInput) => {
  const { t } = useTranslation()
  const [removing, setRemoving] = useState<string | null>(null)

  const reload = () =>
    getSources()
      .then(replace)
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
      })

  const remove = ({ id, name }: SourceStatus) =>
    askToConfirm({
      title: t('confirm.deleteSource.title'),
      message: <RichText i18nKey="confirm.deleteSource.message" values={{ name }} />,
      label: t('confirm.deleteSource.button'),
      proof: ownProof(),
      onConfirm: async proof => {
        setRemoving(id)
        try {
          await removeSource(id, proof)
        } finally {
          setRemoving(null)
        }
        window.dispatchEvent(new Event(TOPICS_CHANGED))
        await reload()
        showSaved(t('sources.deleted', { name }))
      }
    })

  // "Peu ouvertes": hides a group's ones at once, after a question.
  const hideLow = (list: SourceStatus[]) =>
    askToConfirm({
      ...(list.length > 1
        ? {
            title: t('confirm.hideSources.title', { count: list.length }),
            message: <RichText i18nKey="confirm.hideSources.message" values={{ count: list.length }} />,
            label: t('confirm.hideSources.button', { count: list.length })
          }
        : {
            title: t('confirm.hideSource.title'),
            message: <RichText i18nKey="confirm.hideSource.message" values={{ name: list[0]?.name ?? '' }} />,
            label: t('confirm.hideSource.button')
          }),
      onConfirm: () => {
        setMySources(
          list.map(source => source.id),
          false,
          { quiet: true }
        )
        showSaved(t('sources.hidden', { count: list.length }))
      }
    })

  const added = () => {
    // A replacement: the little-read source steps aside for the new one.
    if (adding?.replacing) {
      setMySources([adding.replacing.id], false, { quiet: true })
      showSaved(t('sources.replaced', { name: adding.replacing.name }))
      setAdding(null)
    } else {
      showSaved(t('sources.added'))
    }
    void reload()
  }

  return { removing, remove, hideLow, added }
}
