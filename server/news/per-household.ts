import { currentHouseholdId } from '../db/household-scope.ts'

// A value each household has its own of, read the first time one of its requests asks (household-scope.ts).
export class PerHousehold<T> {
  readonly #values = new Map<number, T>()
  readonly #read: () => T

  constructor(read: () => T) {
    this.#read = read
  }

  get(): T {
    const id = currentHouseholdId()
    if (!this.#values.has(id)) this.#values.set(id, this.#read())
    return this.#values.get(id)!
  }

  set(value: T) {
    this.#values.set(currentHouseholdId(), value)
  }
}
