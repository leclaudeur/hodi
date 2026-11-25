// A number in an address counts only written plainly: « 2.0 », « 0x2 » or « +2 » would name the same row as « 2 »
// to Number() and slip past whatever checks the plain spelling. NaN matches no row, so the route answers 404.
export const idParam = (value: unknown): number =>
  typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : Number.NaN
