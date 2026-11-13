import { clockTime, numericDate } from '../../lib/format.ts'

// A copy's date and time, as its row and its dialogs say them.
export const whenOf = (at: number) => ({ date: numericDate(new Date(at).toISOString()) ?? '', time: clockTime(at) })
