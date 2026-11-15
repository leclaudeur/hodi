import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pluginNamespace, type PluginInfo } from '../../../../plugins/registry.ts'
import Segmented from '../../../../ui/Segmented.tsx'
import TextField from '../../../../ui/TextField.tsx'
import Toggle from '../../../../ui/Toggle.tsx'
import SettingRow from '../../SettingRow.tsx'
import styles from '../../Settings.module.css'

// The error of a plugin written for an older plugin API (OUTDATED_API in server/plugins/manifest.ts).
export const OUTDATED_API = 'outdated_api'

export type Setting =
  | { key: string; type: 'boolean'; default: boolean }
  | { key: string; type: 'number'; default: number; min?: number; max?: number }
  | { key: string; type: 'text'; default: string; maxLength?: number }
  | { key: string; type: 'choice'; default: string; options: string[] }

// A plugin's texts for its settings, from its own locales: settings.<key> and settings.<key>Hint, or the key itself.
const usePluginText = (id: string) => {
  const { i18n } = useTranslation()
  return (key: string, fallback: string) =>
    String(i18n.t(key as never, { ns: pluginNamespace(id), defaultValue: fallback } as never))
}

const SettingControl = ({
  plugin,
  spec,
  disabled,
  onSave
}: {
  plugin: PluginInfo
  spec: Setting
  disabled: boolean
  onSave: (key: string, value: unknown) => void
}) => {
  const text = usePluginText(plugin.id)
  const value = plugin.values[spec.key]
  const [draft, setDraft] = useState(String(value ?? ''))
  const label = text(`settings.${spec.key}`, spec.key)

  if (spec.type === 'boolean')
    return (
      <Toggle checked={value === true} label={label} disabled={disabled} onChange={next => onSave(spec.key, next)} />
    )
  if (spec.type === 'choice')
    return (
      <Segmented
        label={label}
        value={String(value)}
        options={spec.options.map(option => ({
          value: option,
          label: text(`settings.${spec.key}Options.${option}`, option)
        }))}
        onChange={next => !disabled && onSave(spec.key, next)}
      />
    )
  const commit = () => {
    if (draft === String(value ?? '')) return
    onSave(spec.key, spec.type === 'number' ? Number(draft) : draft)
  }
  return (
    <TextField
      icon={Pencil}
      aria-label={label}
      type={spec.type === 'number' ? 'number' : 'text'}
      inputMode={spec.type === 'number' ? 'decimal' : undefined}
      min={spec.type === 'number' ? spec.min : undefined}
      max={spec.type === 'number' ? spec.max : undefined}
      maxLength={spec.type === 'text' ? spec.maxLength : undefined}
      value={draft}
      disabled={disabled}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => event.key === 'Enter' && commit()}
    />
  )
}

interface PluginOptionsProps {
  plugin: PluginInfo
  layout: 'desktop' | 'phone'
  onSave: (settings: Record<string, unknown>) => void
}

// A plugin's own settings, as its manifest lists them, each saved on its own.
export const PluginOptions = ({ plugin, layout, onSave }: PluginOptionsProps) => {
  const { t } = useTranslation()
  const text = usePluginText(plugin.id)
  const specs = plugin.settings as Setting[]
  if (specs.length === 0) return null
  return (
    <>
      <h2 className={styles.label}>{t('plugins.options')}</h2>
      <div className={styles.card}>
        {specs.map(spec => {
          // A saved value starts the field again from it.
          const control = (
            <SettingControl
              key={String(plugin.values[spec.key])}
              plugin={plugin}
              spec={spec}
              disabled={!plugin.enabled}
              onSave={(key, value) => onSave({ [key]: value })}
            />
          )
          const field = spec.type === 'text' || spec.type === 'number'
          return (
            <SettingRow
              key={spec.key}
              // A field is too wide beside its text on a phone: it goes under it.
              className={layout === 'phone' && field ? styles.stackedRow : undefined}
              label={text(`settings.${spec.key}`, spec.key)}
              hint={text(`settings.${spec.key}Hint`, '') || undefined}
              // A choice goes across the row on a phone, as every settings choice.
              choice={spec.type === 'choice' ? control : undefined}
            >
              {spec.type !== 'choice' && control}
            </SettingRow>
          )
        })}
      </div>
    </>
  )
}
