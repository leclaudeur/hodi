import { Component, type ComponentType, type ReactNode } from 'react'
import { PluginScope } from './scope.ts'

interface PluginSlotProps<Props extends object> {
  id: string
  component: ComponentType<Props>
  // What the component is drawn with: a page's layout.
  props?: Props
  // Shown instead when the plugin's code throws while drawing.
  fallback?: ReactNode
}

// Where a plugin draws: its hooks know whose it is, and an error in its code stays inside its own slot.
class Boundary extends Component<{ id: string; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error(`Plugin ${this.props.id} failed:`, error)
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const PluginSlot = <Props extends object = object>({
  id,
  component: Slot,
  props,
  fallback = null
}: PluginSlotProps<Props>) => (
  <PluginScope.Provider value={id}>
    <Boundary id={id} fallback={fallback}>
      <Slot {...(props as Props)} />
    </Boundary>
  </PluginScope.Provider>
)

export default PluginSlot
