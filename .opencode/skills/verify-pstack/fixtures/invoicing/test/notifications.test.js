import assert from "node:assert/strict"
import { test } from "node:test"
import { ValidationError } from "../src/errors.js"
import { createConsoleMailer, createOutbox } from "../src/notifications/mailer.js"
import { createService } from "../src/service.js"

const clock = { now: () => new Date("2026-03-14T10:00:00Z") }

test("issuing an invoice emails the customer every line and the totals", () => {
  const { catalog, customers, carts, checkout, mailer } = createService({ clock })
  catalog.addProduct({ sku: "MUG-01", name: "Mug", unitPrice: 1450 })
  const ada = customers.register({ name: "Ada", email: "ada@example.com", region: "US" })
  const cart = carts.open(ada.id)
  carts.addItem(cart.id, "MUG-01", 2)
  checkout.checkout(cart.id)

  const email = mailer.last()
  assert.equal(email.to, "ada@example.com")
  assert.equal(email.subject, "Invoice INV-2026-0001")
  const lines = email.text.split("\n")
  assert.ok(lines.some((line) => /^Mug x2 +\$29\.00$/.test(line)), "item line shows quantity and amount")
  assert.ok(lines.some((line) => /^Shipping +\$7\.99$/.test(line)), "shipping line")
  assert.ok(lines.some((line) => /^Tax +\$2\.96$/.test(line)), "tax line")
  assert.ok(lines.some((line) => /^Total due +\$39\.95$/.test(line)), "total line")
  assert.match(email.text, /due by 2026-04-13/)
})

test("the outbox refuses malformed messages", () => {
  const outbox = createOutbox()
  assert.throws(() => outbox.send({ to: "nobody", subject: "Hi", text: "x" }), ValidationError)
  assert.throws(() => outbox.send({ to: "a@b.co", subject: "", text: "x" }), ValidationError)
  assert.equal(outbox.sent().length, 0)
})

test("the console mailer prints headers then the body", () => {
  const printed = []
  createConsoleMailer((text) => printed.push(text)).send({ to: "a@b.co", subject: "Hi", text: "Body" })
  assert.match(printed[0], /^From: billing@example-shop\.test\nTo: a@b\.co\nSubject: Hi\n\nBody/)
})
