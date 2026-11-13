import { Puzzle } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useIsPhone } from '../lib/use-media.ts'
import PluginSlot from './PluginSlot.tsx'
import { type AgeConsent, type WebPlugin, pluginNamespace, usePluginSlots } from './registry.ts'

// The layout a full-page slot gets: the phone's below 600 px, the computer's above.
export const useScreenLayout = (): 'desktop' | 'phone' => (useIsPhone() ? 'phone' : 'desktop')

type SlotKey = 'signInExtras' | 'whoIsReadingFooter' | 'accountRows'
type PropsOf<Key extends SlotKey> = NonNullable<WebPlugin[Key]> extends ComponentType<infer Props> ? Props : never

// Every plugin's component for a slot that stacks, in the order of the plugins.
export const PluginSlots = <Key extends SlotKey>({ slot, props }: { slot: Key; props: PropsOf<Key> }) => (
  <>
    {usePluginSlots(slot).map(({ id, value }) => (
      <PluginSlot key={id} id={id} component={value as ComponentType<object>} props={props as object} />
    ))}
  </>
)

// A link of a consent line: an address of this server or https, opened in a new tab so the form stays as it is.
const SAFE_LINK = /^(?:\/(?!\/)|#|https:\/\/)/

const consentLink = (href: string) =>
  SAFE_LINK.test(href) ? (
    // Trans puts the link's text inside.
    <a href={href} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} />
  ) : (
    <span />
  )

const ConsentText = ({ id, consent }: { id: string; consent: AgeConsent }) => {
  const { text, links } = typeof consent === 'string' ? { text: consent, links: {} } : consent
  const components = Object.fromEntries(Object.entries(links).map(([name, href]) => [name, consentLink(href)]))
  return (
    <>
      {' '}
      <Trans ns={pluginNamespace(id) as never} i18nKey={text as never} components={components} />
    </>
  )
}

// What « J'ai au moins 13 ans » goes on with: each plugin's line, after a space.
export const AgeConsentText = () => (
  <>
    {usePluginSlots('ageConsent').map(({ id, value }) => (
      <PluginSlot key={id} id={id} component={ConsentText} props={{ id, consent: value }} />
    ))}
  </>
)

export interface AvatarEntry {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
}

// The plugins' entries of the avatar's menu, their labels in the plugin's texts. A puzzle piece without an icon; an
// entry whose click throws only says so in the console.
export const useAvatarMenu = (): AvatarEntry[] => {
  const { i18n } = useTranslation()
  return usePluginSlots('avatarMenu').flatMap(({ id, value }) =>
    (Array.isArray(value) ? value : [])
      .filter(
        item => typeof item?.id === 'string' && typeof item.label === 'string' && typeof item.onClick === 'function'
      )
      .map(item => ({
        key: `${id}:${item.id}`,
        label: String(i18n.t(item.label as never, { ns: pluginNamespace(id) } as never)),
        icon: item.icon ? (
          <PluginSlot id={id} component={item.icon} props={{ size: 16 }} fallback={<Puzzle size={16} />} />
        ) : (
          <Puzzle size={16} aria-hidden="true" />
        ),
        onClick: () => {
          try {
            item.onClick()
          } catch (error) {
            console.error(`Plugin ${id} failed:`, error)
          }
        }
      }))
  )
}
