import assert from "node:assert/strict"
import { test } from "node:test"
import { ConflictError, NotFoundError, ValidationError } from "../src/errors.js"
import { createService } from "../src/service.js"

const clock = { now: () => new Date("2026-03-14T10:00:00Z") }

test("registers a customer with a normalized email", () => {
  const { customers } = createService({ clock })
  const ada = customers.register({ name: " Ada Lovelace ", email: "Ada@Example.com", region: "CA" })
  assert.deepEqual(ada, { id: "cus_1", name: "Ada Lovelace", email: "ada@example.com", region: "CA", createdAt: "2026-03-14T10:00:00.000Z" })
  assert.equal(customers.findByEmail("ADA@example.com").id, "cus_1")
})

test("refuses bad input and duplicate emails", () => {
  const { customers } = createService({ clock })
  customers.register({ name: "Ada", email: "ada@example.com", region: "CA" })
  assert.throws(() => customers.register({ name: "", email: "x@example.com", region: "CA" }), ValidationError)
  assert.throws(() => customers.register({ name: "Bob", email: "not-an-email", region: "CA" }), ValidationError)
  assert.throws(() => customers.register({ name: "Bob", email: "bob@example.com", region: "MX" }), ValidationError)
  assert.throws(() => customers.register({ name: "Ada 2", email: "ADA@example.com", region: "US" }), ConflictError)
  assert.throws(() => customers.get("cus_404"), NotFoundError)
})

test("changes email only to an unused address", () => {
  const { customers } = createService({ clock })
  const ada = customers.register({ name: "Ada", email: "ada@example.com", region: "CA" })
  customers.register({ name: "Bob", email: "bob@example.com", region: "US" })
  assert.throws(() => customers.updateEmail(ada.id, "bob@example.com"), ConflictError)
  assert.equal(customers.updateEmail(ada.id, "ada@new.example").email, "ada@new.example")
})
