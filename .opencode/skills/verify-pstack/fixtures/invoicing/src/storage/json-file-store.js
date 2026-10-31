import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createMemoryStore } from "./memory-store.js"

export function createJsonFileStore(path) {
  const snapshot = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined
  const store = createMemoryStore(snapshot)
  // Write to a sibling file and rename, so a crash mid-write never leaves half a JSON document.
  store.onChange(() => {
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(store.snapshot(), null, 2)}\n`)
    renameSync(tmp, path)
  })
  return store
}
