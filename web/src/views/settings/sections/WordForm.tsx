import { Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import Button from '../../../ui/Button.tsx'
import TextField from '../../../ui/TextField.tsx'
import styles from '../Settings.module.css'

interface WordFormProps {
  // The words already there: one is not added twice, whatever its case.
  words: string[]
  onAdd: (word: string) => void
  placeholder: string
  label: string
  action: string
}

// A word to follow or to mute: typed, then added with the button (or Enter).
const WordForm = ({ words, onAdd, placeholder, label, action }: WordFormProps) => {
  const [word, setWord] = useState('')

  const add = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = word.trim()
    if (!trimmed) return
    if (!words.some(other => other.toLowerCase() === trimmed.toLowerCase())) onAdd(trimmed)
    setWord('')
  }

  return (
    <form className={styles.fieldRow} onSubmit={add}>
      <TextField
        icon={Plus}
        value={word}
        onChange={event => setWord(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={60}
      />
      <Button look="primary" type="submit" disabled={!word.trim()}>
        {action}
      </Button>
    </form>
  )
}

export default WordForm
