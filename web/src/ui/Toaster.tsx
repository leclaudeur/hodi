import { Suspense, lazy } from 'react'
import { loadToaster } from '../lib/deferred.ts'
import { useToasterWanted } from '../lib/toast.ts'

const SonnerToaster = lazy(loadToaster)

// Toasts (Sonner) come in their own file: placed once the app has shown, or at the first toast if it comes earlier.
const Toaster = () =>
  useToasterWanted() && (
    <Suspense>
      <SonnerToaster />
    </Suspense>
  )

export default Toaster
