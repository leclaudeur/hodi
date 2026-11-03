import { AlertCircle, Check, CircleHelp, Info } from 'lucide-react'
import { type CSSProperties, useEffect } from 'react'
import { Toaster as Sonner } from 'sonner'
import 'sonner/dist/styles.css'
import { useIsDesktop } from '../lib/use-media.ts'
import { toasterMounted } from '../lib/toast.ts'
import styles from './Toaster.module.css'

// On a phone, at the top under the notch, swiped up away: the bottom has the navigation, "Charger…" and
// the voice player. On a computer, bottom right, where nothing floats.
const SonnerToaster = () => {
  const desktop = useIsDesktop()
  // Sonner listens from its own effect, which runs before this one: from here on, a toast shows.
  useEffect(toasterMounted, [])

  return (
    <Sonner
      position={desktop ? 'bottom-right' : 'top-center'}
      swipeDirections={desktop ? ['right'] : ['top']}
      // Above the "Hors ligne" toast while it shows (see ui/OfflineBanner.tsx).
      offset={desktop ? { right: 24, bottom: 'calc(24px + var(--offline-toast, 0px))' } : undefined}
      // Under the status bar and the blur iOS lays under it, as the headers' content.
      mobileOffset={{ top: 'var(--header-top)', left: 12, right: 12 }}
      gap={8}
      // Room for a question and its two buttons on a computer.
      style={{ '--width': '400px' } as CSSProperties}
      visibleToasts={3}
      containerAriaLabel="Messages"
      icons={{
        success: <Check size={16} />,
        error: <AlertCircle size={16} />,
        info: <Info size={16} />,
        warning: <CircleHelp size={16} />
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: styles.toast,
          icon: styles.icon,
          content: styles.content,
          title: styles.title,
          actionButton: styles.action,
          cancelButton: styles.cancel,
          success: styles.success,
          error: styles.error,
          info: styles.info,
          warning: styles.warning
        }
      }}
    />
  )
}

export default SonnerToaster
