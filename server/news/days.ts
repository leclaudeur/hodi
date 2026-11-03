// Calendar days in the reader's time zone, for "Le fil": a day runs from local midnight to the next one,
// 23 or 25 hours long when the clocks change.

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export interface DayRange {
  day: string
  // ISO dates: start included, end excluded.
  start: string
  end: string
}

const formatters = new Map<string, Intl.DateTimeFormat>()

const formatter = (timeZone: string) => {
  let format = formatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    formatters.set(timeZone, format)
  }
  return format
}

// The wall clock in that time zone at that instant, read as if it were UTC.
const wallClock = (at: number, timeZone: string) => {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(at)
      .map(part => [part.type, part.value])
  )
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
}

export const isTimeZone = (value: string) => {
  try {
    formatter(value)
    return true
  } catch {
    return false
  }
}

// YYYY-MM-DD of that instant in the time zone.
export const dayOf = (at: number, timeZone: string) => new Date(wallClock(at, timeZone)).toISOString().slice(0, 10)

// The instant local midnight starts that day, offset by the zone's UTC offset at that time.
const midnight = (utcMidnight: number, timeZone: string) => {
  const guess = utcMidnight - (wallClock(utcMidnight, timeZone) - utcMidnight)
  // The offset may differ at the guess when the clocks changed in between.
  return utcMidnight - (wallClock(guess, timeZone) - guess)
}

// The day's bounds, or null when it is not a real date.
export const dayRange = (day: string, timeZone: string): DayRange | null => {
  const match = DAY_PATTERN.exec(day)
  if (!match) return null
  const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (new Date(utcMidnight).toISOString().slice(0, 10) !== day) return null

  return {
    day,
    start: new Date(midnight(utcMidnight, timeZone)).toISOString(),
    end: new Date(midnight(utcMidnight + 24 * 60 * 60 * 1000, timeZone)).toISOString()
  }
}
