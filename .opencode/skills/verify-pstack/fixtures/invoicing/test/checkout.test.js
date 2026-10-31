import assert from "node:assert/strict"
import { test } from "node:test"
import { balance } from "../src/billing/invoices.js"
import { ConflictError, ValidationError } from "../src/errors.js"
import { createService } from "../src/service.js"

let now = new Date("2026-03-14T10:00:00Z")
const clock = { now: () => now }

function shop() {
  now = new Date("2026-03-14T10:00:00Z")
  const service = createService({ clock })
  service.catalog.addProduct({ sku: "MUG-01", name: "Mug", unitPrice: 1450 })
  const customer = service.customers.register({ name: "Ada", email: "ada@example.com", region: "CA" })
  const cart = service.carts.open(customer.id)
  return { ...service, customer, cart }
}

test("checkout closes the cart, records the order, and issues an invoice", () => {
  const { carts, checkout, cart } = shop()
  carts.addItem(cart.id, "MUG-01", 2)
  const { order, invoice } = checkout.checkout(cart.id)
  assert.equal(carts.get(cart.id).status, "checked_out")
  assert.equal(order.currency, "CAD")
  assert.equal(invoice.number, "INV-2026-0001")
  assert.equal(invoice.total, order.total)
  assert.deepEqual(invoice.lines.map((line) => line.kind), ["item", "shipping"])
  assert.equal(invoice.dueAt, "2026-04-13T10:00:00.000Z")
})

test("an empty or closed cart cannot be checked out", () => {
  const { carts, checkout, cart } = shop()
  assert.throws(() => checkout.checkout(cart.id), ValidationError)
  carts.addItem(cart.id, "MUG-01")
  checkout.checkout(cart.id)
  assert.throws(() => checkout.checkout(cart.id), ConflictError)
})

test("a product pulled after it was added blocks checkout", () => {
  const { carts, catalog, checkout, cart } = shop()
  carts.addItem(cart.id, "MUG-01")
  catalog.deactivate("MUG-01")
  assert.throws(() => checkout.checkout(cart.id), ValidationError)
  assert.equal(carts.get(cart.id).status, "open")
})

test("partial payments keep the invoice open until the balance is zero", () => {
  const { carts, checkout, invoices, mailer, cart } = shop()
  carts.addItem(cart.id, "MUG-01")
  const { invoice } = checkout.checkout(cart.id)
  const half = invoices.recordPayment(invoice.id, 1000)
  assert.equal(half.status, "open")
  assert.equal(balance(half), invoice.total - 1000)
  assert.throws(() => invoices.recordPayment(invoice.id, invoice.total), ValidationError)
  assert.equal(invoices.recordPayment(invoice.id, balance(half)).status, "paid")
  assert.equal(mailer.last().subject, "Receipt for INV-2026-0001")
})

test("only an unpaid open invoice can be voided", () => {
  const { carts, checkout, invoices, cart } = shop()
  carts.addItem(cart.id, "MUG-01")
  const { invoice } = checkout.checkout(cart.id)
  assert.throws(() => invoices.void(invoice.id, " "), ValidationError)
  assert.equal(invoices.void(invoice.id, "duplicate order").status, "void")
  assert.throws(() => invoices.recordPayment(invoice.id, 100), ConflictError)
})

test("invoice numbers restart each year and overdue invoices are found", () => {
  const { carts, checkout, invoices, customer, cart } = shop()
  carts.addItem(cart.id, "MUG-01")
  checkout.checkout(cart.id)
  now = new Date("2027-01-02T09:00:00Z")
  const next = carts.open(customer.id)
  carts.addItem(next.id, "MUG-01")
  assert.equal(checkout.checkout(next.id).invoice.number, "INV-2027-0001")
  assert.deepEqual(invoices.overdue().map((invoice) => invoice.number), ["INV-2026-0001"])
  assert.equal(invoices.listForCustomer(customer.id).length, 2)
})
