import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type SourceStatus,
  TOPICS_CHANGED,
  UnauthorizedError,
  getSourceReaders,
  getSources,
  removeSource
} from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import { updatePreferences } from '../../../lib/preferences.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import { hasNoPassword } from '../../../lib/two-factor.ts'
import RichText from '../../../ui/RichText.tsx'
import type { AddSourceRequest } from './AddSourceDialog.tsx'

interface SourceActionsInput {
  replace: (sources: SourceStatus[]) => void
  hiddenSources: string[]
  adding: AddSourceRequest | null
  setAdding: (request: AddSourceRequest | null) => void
  onUnauthorized: () => void
}

const listOf = (names: string[]) => new Intl.ListFormat(getLanguage(), { type: 'conjunction' }).format(names)

// Removing a source, hiding the little-read ones and taking in a new one, each reloading the list after.
export const useSourceActions = ({ replace, hiddenSources, adding, setAdding, onUnauthorized }: SourceActionsInput) => {
  const { t } = useTranslation()
  const [removing, setRemoving] = useState<string | null>(null)

  const reload = () =>
    getSources()
      .then(replace)
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
      })

  // Only the admin deletes, with their password, once told who reads it: it goes for every profile.
  const remove = async ({ id, name }: SourceStatus) => {
    const readers = await getSourceReaders(id).catch(() => null)
    if (readers === null) {
      showError(t('sources.deleteFailed'))
      return
    }
    askToConfirm({
      title: t('confirm.deleteSource.title'),
      message: (
        <RichText
          i18nKey={readers.length > 0 ? 'confirm.deleteSource.message' : 'confirm.deleteSource.messageNoReader'}
          values={{ name, readers: listOf(readers) }}
        />
      ),
      label: t('confirm.deleteSource.button'),
      proof: hasNoPassword() ? { noPassword: true } : {},
      // A wrong password stays in the dialog.
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
  }

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
        updatePreferences({
          hiddenSources: [...new Set([...hiddenSources, ...list.map(source => source.id)])]
        })
        showSaved(t('sources.hidden', { count: list.length }))
      }
    })

  const added = () => {
    // A replacement: the little-read source steps aside for the new one.
    if (adding?.replacing) {
      updatePreferences({ hiddenSources: [...hiddenSources, adding.replacing.id] }, { quiet: true })
      showSaved(t('sources.replaced', { name: adding.replacing.name }))
      setAdding(null)
    } else {
      showSaved(t('sources.added'))
    }
    void reload()
  }

  return { removing, remove, hideLow, added }
}
