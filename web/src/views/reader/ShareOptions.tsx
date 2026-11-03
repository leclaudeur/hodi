import { Check, Link2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  EmailIcon,
  EmailShareButton,
  FacebookMessengerIcon,
  FacebookMessengerShareButton,
  WhatsappIcon,
  WhatsappShareButton
} from 'react-share'
import styles from './ShareMenu.module.css'

// Messenger opens its app on a phone; on a computer its web dialog needs a Facebook app id, which Hodi has not.
const MESSENGER_APP_ID = ''

interface ShareOptionsProps {
  url: string
  title: string
  phone: boolean
}

// The ways to share, in their own file with react-share: loaded once the app has shown (lib/deferred.ts), not before
// the first screen.
const ShareOptions = ({ url, title, phone }: ShareOptionsProps) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt(t('shareMenu.copyPrompt'), url)
    }
  }

  return (
    <div className={styles.options}>
      <button type="button" className={styles.option} role="menuitem" onClick={() => void copy()}>
        <span className={styles.tile}>{copied ? <Check size={20} /> : <Link2 size={20} />}</span>
        {t(copied ? 'shareMenu.copied' : 'shareMenu.copy')}
      </button>
      <EmailShareButton
        url={url}
        subject={title}
        body={`${title}\n\n`}
        resetButtonStyle={false}
        className={styles.option}
        role="menuitem"
      >
        <span className={styles.tile}>
          <EmailIcon size={22} />
        </span>
        {t('shareMenu.email')}
      </EmailShareButton>
      <WhatsappShareButton
        url={url}
        message={title}
        separator={' \n'}
        resetButtonStyle={false}
        className={styles.option}
        role="menuitem"
      >
        <span className={styles.tile}>
          <WhatsappIcon size={22} />
        </span>
        WhatsApp
      </WhatsappShareButton>
      {phone && (
        <FacebookMessengerShareButton
          url={url}
          appId={MESSENGER_APP_ID}
          mobileBehavior="app"
          resetButtonStyle={false}
          className={styles.option}
          role="menuitem"
        >
          <span className={styles.tile}>
            <FacebookMessengerIcon size={22} />
          </span>
          Messenger
        </FacebookMessengerShareButton>
      )}
    </div>
  )
}

export default ShareOptions
