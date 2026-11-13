import { type ComponentProps, Suspense, lazy } from 'react'
import styles from './QrCode.module.css'

// The QR code's maker downloads only when a code is shown: a sign-in code or the server's two-step setup.
const QrCode = lazy(() => import('./QrCode.tsx'))

// Until then, an empty square of the same size, so nothing moves when it draws.
const LazyQrCode = (props: ComponentProps<typeof QrCode>) => {
  const size = props.size ?? 168
  return (
    <Suspense fallback={<svg className={styles.code} width={size} height={size} aria-hidden="true" />}>
      <QrCode {...props} />
    </Suspense>
  )
}

export default LazyQrCode
