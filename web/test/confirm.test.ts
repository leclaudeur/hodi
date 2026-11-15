import { describe, expect, it, vi } from 'vitest'
import { askToConfirm, cancelConfirmation, closeConfirmation } from '../src/lib/confirm.ts'

const question = (onCancel: () => void) => ({
  title: 'Effacer ?',
  message: 'Tout.',
  label: 'Effacer',
  onConfirm: () => {},
  onCancel
})

describe('askToConfirm', () => {
  it('tells whoever asked when the question is closed without its button', () => {
    const onCancel = vi.fn()
    askToConfirm(question(onCancel))
    cancelConfirmation()
    expect(onCancel).toHaveBeenCalledOnce()
    // Nothing open any more: closing again tells nobody.
    cancelConfirmation()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not call onCancel once the button answered', () => {
    const onCancel = vi.fn()
    askToConfirm(question(onCancel))
    closeConfirmation()
    cancelConfirmation()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
