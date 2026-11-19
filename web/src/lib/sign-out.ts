import i18next from 'i18next'
import { createElement } from 'react'
import { getProfiles, logout } from '../api.ts'
import RichText from '../ui/RichText.tsx'
import { askToConfirm } from './confirm.ts'
import { t } from './i18n.ts'
import { isYoung } from './profiles.ts'

const names = (list: { name: string }[]) =>
  new Intl.ListFormat(i18next.language, { type: 'conjunction' }).format(list.map(profile => profile.name))

// What « Se déconnecter » says first: who stays in « Qui lit ? » on this device, or that the last adult takes the
// young profiles with them, or that the device goes back to Connexion.
const messageOf = async () => {
  const { profiles, current } = await getProfiles()
  const others = profiles.filter(profile => profile.here !== false && profile.id !== current)
  const young = others.filter(isYoung)
  if (others.some(profile => !isYoung(profile)))
    return createElement(RichText, {
      i18nKey: 'confirm.signOut.message',
      values: { others: names(others), count: others.length }
    })
  if (young.length > 0)
    return createElement(RichText, {
      i18nKey: 'confirm.signOut.messageLast',
      values: { young: names(young), count: young.length }
    })
  return t('confirm.signOut.messageAlone')
}

// « Se déconnecter »: the account whose profile is open leaves this device, the others stay. The app then starts
// again, on « Qui lit ? » or Connexion.
export const confirmSignOut = async () => {
  const message = await messageOf().catch(() => t('confirm.signOut.messageAlone'))
  askToConfirm({
    title: t('confirm.signOut.title'),
    message,
    label: t('confirm.signOut.button'),
    onConfirm: async () => {
      await logout()
      window.location.reload()
    }
  })
}
