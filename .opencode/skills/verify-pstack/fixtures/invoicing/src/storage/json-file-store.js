import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createMemoryStore } from "./memory-store.js"

function writeFileAtomic(path, text) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

export function createJsonFileStore(path) {
  const snapshot = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined
  const store = createMemoryStore(snapshot)
  store.onChange(() => writeFileAtomic(path, `${JSON.stringify(store.snapshot(), null, 2)}\n`))
  return store
}
