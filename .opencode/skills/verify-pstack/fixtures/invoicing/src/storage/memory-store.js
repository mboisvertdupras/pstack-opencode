import { ConflictError, NotFoundError } from "../errors.js"

const clone = (value) => structuredClone(value)

export function createMemoryStore(snapshot = { collections: {}, sequences: {} }) {
  const collections = new Map(
    Object.entries(snapshot.collections).map(([name, records]) => [name, new Map(records.map((record) => [record.id, clone(record)]))]),
  )
  const sequences = new Map(Object.entries(snapshot.sequences))
  const listeners = []

  const collection = (name) => {
    if (!collections.has(name)) collections.set(name, new Map())
    return collections.get(name)
  }
  const changed = () => listeners.forEach((listener) => listener())

  return {
    insert(name, record) {
      if (!record.id) throw new TypeError(`${name} record needs an id`)
      const records = collection(name)
      if (records.has(record.id)) throw new ConflictError(`${name} ${record.id} already exists`)
      records.set(record.id, clone(record))
      changed()
      return clone(record)
    },

    update(name, id, changes) {
      const records = collection(name)
      const current = records.get(id)
      if (!current) throw new NotFoundError(name, id)
      const next = { ...current, ...clone(changes), id }
      records.set(id, next)
      changed()
      return clone(next)
    },

    get(name, id) {
      const record = collection(name).get(id)
      return record ? clone(record) : undefined
    },

    find(name, predicate = () => true) {
      return [...collection(name).values()].filter(predicate).map(clone)
    },

    sequence(name) {
      const next = (sequences.get(name) ?? 0) + 1
      sequences.set(name, next)
      changed()
      return next
    },

    snapshot() {
      return {
        collections: Object.fromEntries([...collections].map(([name, records]) => [name, [...records.values()].map(clone)])),
        sequences: Object.fromEntries(sequences),
      }
    },

    onChange(listener) {
      listeners.push(listener)
    },
  }
}
