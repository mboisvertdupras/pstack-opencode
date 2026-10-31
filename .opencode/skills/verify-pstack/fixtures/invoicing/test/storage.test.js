import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { ConflictError, NotFoundError } from "../src/errors.js"
import { createJsonFileStore } from "../src/storage/json-file-store.js"
import { createMemoryStore } from "../src/storage/memory-store.js"

test("returns copies, so callers cannot mutate stored records", () => {
  const store = createMemoryStore()
  const record = store.insert("things", { id: "a", tags: ["x"] })
  record.tags.push("y")
  assert.deepEqual(store.get("things", "a").tags, ["x"])
})

test("rejects duplicate ids and updates to missing records", () => {
  const store = createMemoryStore()
  store.insert("things", { id: "a" })
  assert.throws(() => store.insert("things", { id: "a" }), ConflictError)
  assert.throws(() => store.update("things", "b", {}), NotFoundError)
})

test("keeps independent sequences per name", () => {
  const store = createMemoryStore()
  assert.deepEqual([store.sequence("a"), store.sequence("a"), store.sequence("b")], [1, 2, 1])
})

test("the file store survives a reload", () => {
  const path = join(mkdtempSync(join(tmpdir(), "invoicing-")), "db.json")
  const first = createJsonFileStore(path)
  first.insert("things", { id: `t${first.sequence("things")}` })
  const second = createJsonFileStore(path)
  assert.deepEqual(second.find("things").map((thing) => thing.id), ["t1"])
  assert.equal(second.sequence("things"), 2)
  assert.ok(JSON.parse(readFileSync(path, "utf8")).collections.things)
})
