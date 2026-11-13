import qrcode from 'qrcode-generator'
import { useMemo } from 'react'
import styles from './QrCode.module.css'

interface QrCodeProps {
  value: string
  label: string
  // Its whole width, quiet zone included.
  size?: number
}

// A link as a QR code, scanned by the phone's camera: dark on white whatever the theme (--qr-ink). The
// squares come from qrcode-generator; drawing them as one path keeps them crisp at any size.
const QrCode = ({ value, label, size = 168 }: QrCodeProps) => {
  const { count, path } = useMemo(() => {
    // 0: the smallest version the link fits in; M: still read with a scratch or a glare.
    const code = qrcode(0, 'M')
    code.addData(value)
    code.make()
    const modules = code.getModuleCount()
    let d = ''
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`
      }
    }
    return { count: modules, path: d }
  }, [value])

  // Four modules of quiet zone around it, as the standard asks.
  const margin = 4
  return (
    <svg
      className={styles.code}
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-margin} ${-margin} ${count + margin * 2} ${count + margin * 2}`}
      shapeRendering="crispEdges"
    >
      <path d={path} />
    </svg>
  )
}

export default QrCode
